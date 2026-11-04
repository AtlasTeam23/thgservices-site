// Push-to-talk and reading replies aloud, as a controller the chat state machine owns
// (voice plan section 3, W4). It never touches React: it reads and writes the chat's state
// through `get` and `patch`, and sends a finished transcript through `send`, so every guard,
// limit and analytics rule that applies to typing applies to speaking too.

import { track } from '../../../lib/track';
import { fetchTts, fetchVoiceCaps, postStt, type SttResult } from '../api';
import { RATE_LIMITED } from '../copy';
import { makeMessage, TURNSTILE_AFTER_TURN } from '../thread';
import { getToken } from '../turnstile';
import type { ConciergeState } from '../useConcierge';
import {
  VOICE_DENIED,
  VOICE_ERROR,
  VOICE_HEARD_NOTHING,
  VOICE_HOLD_HINT,
  VOICE_NO_MIC,
  VOICE_OFF,
} from './copy';
import { loadVoicePrefs, saveVoicePrefs, type VoicePrefs } from './prefs';
import {
  isRecordingSupported,
  MIN_RECORDING_MS,
  startRecording,
  VoiceError,
  type Recording,
  type RecordingResult,
} from './recorder';
import {
  isSpeechSupported,
  speak,
  stopSpeaking as stopReading,
  unlockSpeech,
  type SpeechMode,
} from './speech';

/**
 * `off` means no voice controls at all: this browser cannot record, the Worker has no speech
 * to text, or voice gave up for the session. It is also the state before the first /health
 * answer arrives.
 */
export type VoiceState = 'idle' | 'recording' | 'transcribing' | 'speaking' | 'off';

export type VoiceHost = {
  get: () => ConciergeState;
  patch: (patch: Partial<ConciergeState>) => void;
  /** Send text as the visitor's message through the normal chat path. */
  send: (text: string) => Promise<void>;
};

/** The voice part of the chat state, as it starts out. */
export function initialVoiceState(): Pick<
  ConciergeState,
  'voice' | 'voiceEnding' | 'voiceNotice' | 'speakEnabled' | 'speakAvailable' | 'voiceDisclosed'
> {
  return {
    voice: 'off',
    voiceEnding: false,
    voiceNotice: null,
    speakEnabled: loadVoicePrefs().speak ?? false,
    speakAvailable: false,
    voiceDisclosed: false,
  };
}

export function createVoiceController({ get, patch, send }: VoiceHost) {
  let prefs: VoicePrefs = loadVoicePrefs();

  /** Which voice reads replies; /health decides. */
  let ttsMode: SpeechMode = 'browser';
  let checked = false;
  /** Voice gave up for this session (budget spent, no microphone); a late /health cannot revive it. */
  let blocked = prefs.blocked;
  /** The panel is open and the tab visible: the only time a reply is read aloud. */
  let active = true;
  let recording: Recording | null = null;
  /** Identifies the press that is waiting on the microphone; bumped to abandon it. */
  let pressId = 0;
  let awaitingMic = false;
  let releasedEarly = false;
  /** Bumped to drop a transcript that is still on its way. */
  let transcriptId = 0;
  const levelListeners = new Set<(level: number) => void>();

  const subscribeLevel = (listener: (level: number) => void) => {
    levelListeners.add(listener);
    return () => {
      levelListeners.delete(listener);
    };
  };

  /** Ask the Worker once whether voice is on. Browsers that cannot record never ask. */
  const checkVoice = async (): Promise<void> => {
    if (checked || blocked || !isRecordingSupported()) return;
    checked = true;
    let caps: Awaited<ReturnType<typeof fetchVoiceCaps>> = null;
    try {
      caps = await fetchVoiceCaps();
    } catch {
      // treated as "no voice"
    }
    if (!caps || blocked) return;
    ttsMode = caps.tts;
    if (get().voice === 'off') {
      patch({ voice: 'idle', speakAvailable: ttsMode === 'aura' || isSpeechSupported() });
    }
  };

  /** Stop reading aloud (any new input does this). */
  const stopSpeaking = () => {
    stopReading();
    if (get().voice === 'speaking') patch({ voice: 'idle' });
  };

  /**
   * Throw away a recording in progress or a press still waiting on the microphone. A transcript
   * already on its way is left to finish (a hidden tab, for one, should not lose the question).
   */
  const cancelRecording = () => {
    pressId += 1;
    const rec = recording;
    recording = null;
    rec?.cancel();
    const { voice, voiceEnding } = get();
    if (voice === 'recording' || voiceEnding) patch({ voice: 'idle', voiceEnding: false });
  };

  /** A recording, a press waiting on the microphone, and a transcript in flight: all dropped. */
  const cancelVoice = () => {
    transcriptId += 1;
    cancelRecording();
    if (get().voice === 'transcribing') patch({ voice: 'idle' });
  };

  /** The panel was closed or unmounted: the microphone and the speaker both stop. */
  const stopAll = () => {
    cancelVoice();
    stopSpeaking();
    // The microphone line was for this first visit to voice; it is not shown a second time.
    if (get().voiceDisclosed) patch({ voiceDisclosed: false });
  };

  /** Whether the panel is open and the tab visible. Replies that land while it is not are not read. */
  const setActive = (value: boolean) => {
    active = value;
  };

  /** Hide every voice control for the rest of the session. */
  const voiceOff = (reason: 'unsupported' | 'budget' | 'server', notice: string) => {
    blocked = true;
    if (reason === 'budget') {
      // The day's allowance is gone: a reload in this tab should not offer the mic again.
      prefs = { ...prefs, blocked: true };
      saveVoicePrefs(prefs);
    }
    cancelVoice();
    stopReading();
    track('concierge_voice_error', { reason });
    patch({ voice: 'off', voiceEnding: false, voiceNotice: notice });
  };

  const failStart = (error: unknown) => {
    const reason = error instanceof VoiceError ? error.reason : 'device';
    if (reason === 'permission') {
      track('concierge_voice_error', { reason: 'permission' });
      patch({ voice: 'idle', voiceEnding: false, voiceNotice: VOICE_DENIED });
    } else if (reason === 'unsupported') {
      voiceOff('unsupported', VOICE_NO_MIC);
    } else {
      // Busy or broken for now: say so, keep the button.
      track('concierge_voice_error', { reason: 'unsupported' });
      patch({ voice: 'idle', voiceEnding: false, voiceNotice: VOICE_NO_MIC });
    }
  };

  const transcribe = async (clip: RecordingResult): Promise<void> => {
    transcriptId += 1;
    const id = transcriptId;
    patch({ voice: 'transcribing', voiceEnding: false, voiceNotice: null });

    let res: SttResult;
    try {
      // Same rule as /chat: a token from the 11th message on.
      const token = get().turn + 1 > TURNSTILE_AFTER_TURN ? await getToken() : null;
      res = await postStt(clip.blob, clip.mime, get().sessionId, token, clip.durationMs);
      if (res.kind === 'verification_required') {
        // Fetch a token and retry once; a second demand is a plain error.
        const retryToken = await getToken();
        res = retryToken
          ? await postStt(clip.blob, clip.mime, get().sessionId, retryToken, clip.durationMs)
          : { kind: 'error', reason: 'server' };
      }
    } catch {
      res = { kind: 'error', reason: 'network' };
    }
    if (id !== transcriptId) return; // cancelled while waiting

    switch (res.kind) {
      case 'ok': {
        const text = res.text.trim();
        if (!text) {
          track('concierge_voice_empty');
          patch({ voice: 'idle', voiceNotice: VOICE_HEARD_NOTHING });
          return;
        }
        track('concierge_voice_transcribed', {
          seconds: Math.min(20, Math.max(0, Math.round(clip.durationMs / 1000))),
        });
        patch({ voice: 'idle' });
        await send(text);
        return;
      }
      case 'voice_unavailable':
        voiceOff(res.reason, VOICE_OFF);
        return;
      case 'rate_limited':
        track('concierge_rate_limited');
        patch({
          messages: [...get().messages, makeMessage('assistant', RATE_LIMITED)],
          voice: 'idle',
          status: 'idle',
          chips: [],
        });
        return;
      default:
        // bad_audio, a second verification demand, network, timeout, server
        track('concierge_voice_error', { reason: 'server' });
        patch({ voice: 'idle', voiceNotice: VOICE_ERROR });
    }
  };

  const onRecorded = (rec: Recording, clip: RecordingResult | null, hold: boolean) => {
    if (recording !== rec) return; // cancelled, or replaced by a newer recording
    recording = null;
    if (!clip || clip.durationMs < MIN_RECORDING_MS) {
      // Nothing worth sending. A touch press that was let go at once gets the hint.
      patch({
        voice: 'idle',
        voiceEnding: false,
        voiceNotice: hold && clip ? VOICE_HOLD_HINT : VOICE_HEARD_NOTHING,
      });
      return;
    }
    void transcribe(clip);
  };

  /**
   * The mic was pressed. `hold` is true for a touch press-and-hold (a too-short press then
   * gets a "hold the button" hint instead of "didn't catch that"). Everything before the
   * first await runs inside the visitor's tap, which is what iOS needs for audio.
   */
  const startVoice = async (opts: { hold?: boolean } = {}): Promise<void> => {
    if (get().voice !== 'idle' && get().voice !== 'speaking') return;
    if (get().status !== 'idle') return;

    stopSpeaking();
    unlockSpeech(ttsMode);
    patch({ voice: 'recording', voiceEnding: false, voiceNotice: null });

    pressId += 1;
    const id = pressId;
    awaitingMic = true;
    releasedEarly = false;
    const hold = opts.hold === true;

    let rec: Recording;
    try {
      rec = await startRecording({
        onLevel: (level) => levelListeners.forEach((listener) => listener(level)),
        onEnding: () => {
          if (recording && get().voice === 'recording') patch({ voiceEnding: true });
        },
      });
    } catch (error) {
      if (id !== pressId) return; // abandoned while waiting
      awaitingMic = false;
      failStart(error);
      return;
    }

    if (id !== pressId) {
      rec.cancel(); // cancelled while the permission prompt was open
      return;
    }
    awaitingMic = false;
    if (releasedEarly) {
      // Let go before the microphone was ready (the permission prompt): nothing was said.
      rec.cancel();
      patch({
        voice: 'idle',
        voiceEnding: false,
        voiceNotice: hold ? VOICE_HOLD_HINT : VOICE_HEARD_NOTHING,
      });
      return;
    }

    // The first time a recording really starts: show the microphone line, and read replies
    // aloud unless the visitor already chose otherwise. A refused or abandoned first press
    // is not a first use.
    const first: Partial<ConciergeState> = {};
    if (!prefs.disclosed) {
      const speakOn = prefs.speak ?? true;
      prefs = { ...prefs, speak: speakOn, disclosed: true };
      saveVoicePrefs(prefs);
      first.voiceDisclosed = true;
      first.speakEnabled = speakOn;
    }
    if (Object.keys(first).length > 0) patch(first);

    recording = rec;
    track('concierge_voice_start');
    void rec.result.then((clip) => onRecorded(rec, clip, hold));
  };

  /** The mic was released (or clicked a second time). */
  const stopVoice = () => {
    if (get().voice !== 'recording') return;
    if (recording) recording.stop(); // onRecorded carries on from there
    else if (awaitingMic) releasedEarly = true;
  };

  /** Inside a tap on the mic or the speaker toggle: let iOS know speech is wanted. */
  const unlock = () => unlockSpeech(ttsMode);

  const setSpeakEnabled = (on: boolean) => {
    if (on) unlockSpeech(ttsMode);
    else stopSpeaking();
    prefs = { ...prefs, speak: on };
    saveVoicePrefs(prefs);
    patch({ speakEnabled: on });
  };

  const speakReply = (text: string) => {
    const { speakEnabled, voice } = get();
    if (!active || !speakEnabled) return;
    if (voice === 'off' || voice === 'recording' || voice === 'transcribing') return;
    if (ttsMode !== 'aura' && !isSpeechSupported()) return;
    speak(text, ttsMode, {
      fetchAudio:
        ttsMode === 'aura'
          ? async (t) => {
              const res = await fetchTts(t, get().sessionId);
              return res.kind === 'ok' ? res.blob : null;
            }
          : undefined,
      onStart: (mode) => {
        if (get().voice === 'idle') patch({ voice: 'speaking' });
        track('concierge_voice_reply_spoken', { mode });
      },
      onEnd: () => {
        if (get().voice === 'speaking') patch({ voice: 'idle' });
      },
    });
  };

  return {
    checkVoice,
    startVoice,
    stopVoice,
    cancelVoice,
    cancelRecording,
    stopAll,
    setActive,
    stopSpeaking,
    setSpeakEnabled,
    speakReply,
    unlock,
    subscribeLevel,
  };
}
