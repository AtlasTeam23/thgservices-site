// Push-to-talk and reading replies aloud, as a controller the chat state machine owns
// (voice plan section 3, W4). It never touches React: it reads and writes the chat's state
// through `get` and `patch`, and sends a finished transcript through `send`, so every guard,
// limit and analytics rule that applies to typing applies to speaking too.

import { track } from '../../../lib/track';
import { fetchTts, fetchVoiceCaps, postStt, type SttResult, type VoiceCaps } from '../api';
import { RATE_LIMITED } from '../copy';
import { makeMessage, TURNSTILE_AFTER_TURN } from '../thread';
import { getToken } from '../turnstile';
import type { ConciergeState } from '../useConcierge';
import {
  DEFAULT_BONUS_REPLIES,
  VOICE_DENIED,
  VOICE_ERROR,
  VOICE_HEARD_NOTHING,
  VOICE_HOLD_HINT,
  VOICE_NO_MIC,
  VOICE_OFF,
  VOICE_SOUND_OFF_HINT,
  VOICE_SPOKEN_LIMIT_DONE,
} from './copy';
import { claimGreeting } from './greeting';
import { sharedVoiceCaps } from './health';
import {
  loadVoicePrefs,
  saveVoicePrefs,
  spokenCapInForce,
  withoutCap,
  type VoicePrefs,
} from './prefs';
import {
  isRecordingSupported,
  MIN_RECORDING_MS,
  startRecording,
  VoiceError,
  type Recording,
  type RecordingResult,
} from './recorder';
import {
  speak,
  speakBlob,
  stopSpeaking as stopReading,
  unlockSpeech,
  watchSpeech,
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
  | 'voice'
  | 'voiceEnding'
  | 'voiceNotice'
  | 'speakEnabled'
  | 'speakAvailable'
  | 'voiceDisclosed'
  | 'blockedReplyId'
  | 'readAloudBonus'
  | 'bonusCount'
> {
  return {
    voice: 'off',
    voiceEnding: false,
    voiceNotice: null,
    speakEnabled: loadVoicePrefs().speak ?? false,
    speakAvailable: false,
    voiceDisclosed: false,
    blockedReplyId: null,
    readAloudBonus: false,
    bonusCount: DEFAULT_BONUS_REPLIES,
  };
}

export function createVoiceController({ get, patch, send }: VoiceHost) {
  let prefs: VoicePrefs = loadVoicePrefs();

  /** Whether replies are read aloud (by the server voice); /health decides. 'none' is text only. */
  let ttsMode: 'server' | 'none' = 'none';
  /**
   * The audio the browser would not start (a reply, or the opening greeting), kept so that a tap can
   * play it (no second request).
   */
  let held: { blob: Blob; messageId: string; mode: SpeechMode } | null = null;
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

  /**
   * The cap on spoken replies is in force. A cap that has lapsed (an hour, or a new day) is
   * dropped here, so even a panel left open comes back to asking for audio.
   */
  const capInForce = (): boolean => {
    if (!prefs.spokenLimit) return false;
    if (spokenCapInForce(prefs, Date.now())) return true;
    prefs = withoutCap(prefs);
    saveVoicePrefs(prefs);
    patch({ speakAvailable: ttsMode === 'server', readAloudBonus: false });
    return false;
  };

  /** Replies can be read aloud: there is a server voice, and the day's allowance is not used up. */
  const canSpeak = (): boolean => ttsMode === 'server' && !capInForce();

  /**
   * Ask the Worker once whether voice is on. Browsers that cannot record never ask. The answer the
   * bubble fetched when the page loaded (for the greeting) is reused rather than asked for again.
   */
  const checkVoice = async (): Promise<void> => {
    if (checked || blocked || !isRecordingSupported()) return;
    checked = true;
    let caps: VoiceCaps | null = null;
    try {
      // The page-load answer, when there is one (null in it is a definitive "no voice"); otherwise ask.
      const shared = await sharedVoiceCaps();
      caps = shared === undefined ? await fetchVoiceCaps() : shared;
    } catch {
      // treated as "no voice"
    }
    if (!caps || blocked) return;
    ttsMode = caps.tts;
    if (get().voice === 'off') {
      patch({
        voice: 'idle',
        speakAvailable: canSpeak(),
        // The cap and the bonus on offer outlive a reload in the same tab.
        readAloudBonus:
          ttsMode === 'server' && prefs.spokenLimit && prefs.bonusOffer && !prefs.bonusUsed && !get().leadDone,
        bonusCount: prefs.bonusCount ?? DEFAULT_BONUS_REPLIES,
      });
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
    unlock();
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
  const unlock = () => {
    if (ttsMode === 'server') unlockSpeech();
  };

  /** Forget the reply that is waiting for a tap (a newer reply, or sound turned off, replaces it). */
  const clearBlocked = () => {
    held = null;
    if (get().blockedReplyId !== null) patch({ blockedReplyId: null });
  };

  const setSpeakEnabled = (on: boolean) => {
    if (on) unlock();
    else {
      stopSpeaking();
      clearBlocked();
    }
    prefs = { ...prefs, speak: on };
    saveVoicePrefs(prefs);
    patch({ speakEnabled: on });
  };

  /** The day's allowance of spoken replies is used up: text only from here, until a bonus is granted. */
  const limitReached = (bonusAvailable: boolean, bonus?: number) => {
    if (capInForce()) return; // one report is enough
    const offer = bonusAvailable && !prefs.bonusUsed && !get().leadDone;
    prefs = {
      ...prefs,
      spokenLimit: true,
      spokenLimitAt: Date.now(),
      bonusOffer: offer,
      bonusCount: offer && bonus !== undefined ? bonus : null,
    };
    saveVoicePrefs(prefs);
    clearBlocked();
    track('concierge_voice_error', { reason: 'budget' });
    patch({
      speakAvailable: false,
      readAloudBonus: offer,
      bonusCount: prefs.bonusCount ?? DEFAULT_BONUS_REPLIES,
      // With a bonus on offer the notice (and its chip) stay up; otherwise one line, once.
      voiceNotice: offer ? null : VOICE_SPOKEN_LIMIT_DONE,
    });
  };

  /**
   * A lead was sent. With an email, that is the bonus on offer, so spoken replies resume. Without
   * one the offer is over (a second form cannot be opened), so the chip must go, and the cap stays.
   */
  const noteLeadSubmitted = (hasEmail: boolean) => {
    if (!prefs.spokenLimit || !prefs.bonusOffer) return;
    if (hasEmail) {
      prefs = { ...withoutCap(prefs), bonusUsed: true };
      saveVoicePrefs(prefs);
      patch({ readAloudBonus: false, speakAvailable: canSpeak() });
    } else {
      prefs = { ...prefs, bonusOffer: false };
      saveVoicePrefs(prefs);
      patch({ readAloudBonus: false, voiceNotice: VOICE_SPOKEN_LIMIT_DONE });
    }
  };

  /** The browser would not start this audio (a reply, or the greeting): offer a tap, once explain why. */
  const audioBlocked = (blob: Blob, messageId: string | undefined, mode: SpeechMode = 'server') => {
    if (!messageId) return;
    held = { blob, messageId, mode };
    const notice: Partial<ConciergeState> = { blockedReplyId: messageId };
    if (!prefs.soundHint) {
      prefs = { ...prefs, soundHint: true };
      saveVoicePrefs(prefs);
      notice.voiceNotice = VOICE_SOUND_OFF_HINT;
    }
    patch(notice);
  };

  /** Sound is playing: the equalizer shows, and a waiting tap-to-hear pill or its hint goes. */
  const markSpeaking = () => {
    patch({
      blockedReplyId: null,
      ...(get().voice === 'idle' ? { voice: 'speaking' as const } : {}),
      // Once audio is playing, "Sound is off until you tap." is no longer true.
      ...(get().voiceNotice === VOICE_SOUND_OFF_HINT ? { voiceNotice: null } : {}),
    });
  };

  const onSpeechStart = (mode: SpeechMode) => {
    held = null;
    markSpeaking();
    // The greeting (started here by a tap on its pill) is not a spoken reply: it has its own event.
    if (mode === 'greeting') track('concierge_greeting_played');
    else track('concierge_voice_reply_spoken', { mode });
  };

  const onSpeechEnd = () => {
    if (get().voice === 'speaking') patch({ voice: 'idle' });
  };

  const speakReply = (text: string, messageId?: string) => {
    clearBlocked(); // a newer reply replaces whatever was waiting for a tap
    const { speakEnabled, voice } = get();
    if (!active || !speakEnabled || !canSpeak()) return;
    if (voice === 'off' || voice === 'recording' || voice === 'transcribing') return;
    speak(text, {
      fetchAudio: (t, signal) => fetchTts(t, get().sessionId, signal),
      canPlay: () => active, // closed or hidden while the request was out: drop the clip
      onStart: onSpeechStart,
      onEnd: onSpeechEnd,
      onLimit: limitReached,
      onBlocked: (blob) => audioBlocked(blob, messageId),
    });
  };

  /** The "Tap to hear replies" pill was tapped: play the reply that was waiting, inside this tap. */
  const playBlocked = () => {
    const pending = held;
    const { voice } = get();
    if (!pending || voice === 'recording' || voice === 'transcribing') return;
    speakBlob(pending.blob, {
      mode: pending.mode,
      onStart: onSpeechStart,
      onEnd: onSpeechEnd,
      // Even the tap was refused: the pill stays, with the same audio.
      onBlocked: (blob) => audioBlocked(blob, pending.messageId, pending.mode),
    });
  };

  /**
   * The recorded greeting was started by the click that opened the chat, before this controller
   * existed (see voice/greeting.ts). Take it over: the preferences that click wrote, the speaking
   * state while it plays, and its audio if the browser refused it (then a tap plays it, like a
   * blocked reply). Call it once the greeting message is in the thread and /health has been read.
   */
  const adoptGreeting = (messageId: string | undefined) => {
    const claim = claimGreeting((blob) => audioBlocked(blob, messageId, 'greeting'));
    if (!claim) return;
    // What the click saved goes into this controller's copy before anything here saves prefs again.
    prefs = { ...prefs, speak: true, disclosed: true, greeted: true };
    patch({ speakEnabled: true, voiceDisclosed: true });
    // Already playing, or about to: show it like a spoken reply, and go back to idle at the end.
    watchSpeech({ onStart: markSpeaking, onEnd: onSpeechEnd }, 'greeting');
    if (claim.blob) audioBlocked(claim.blob, messageId, 'greeting');
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
    playBlocked,
    adoptGreeting,
    noteLeadSubmitted,
    unlock,
    subscribeLevel,
  };
}
