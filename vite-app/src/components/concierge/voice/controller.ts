// Reading replies aloud (and taking over the opening greeting), as a controller the chat state
// machine owns. It never touches React: it reads and writes the chat's state through `get` and
// `patch`. There is no voice input: visitors type, and the chat talks back.

import { track } from '../../../lib/track';
import { fetchTts, fetchVoiceCaps, type VoiceCaps } from '../api';
import type { ConciergeState } from '../useConcierge';
import {
  DEFAULT_BONUS_REPLIES,
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
  activeSpeechMode,
  cancelQueued,
  speak,
  speakAfterGreeting,
  speakBlob,
  stopSpeaking as stopReading,
  unlockSpeech,
  watchSpeech,
  type SpeechMode,
} from './speech';

/**
 * `off` means no voice controls at all: the Worker has no server voice, or voice gave up for the
 * session. It is also the state before the first /health answer arrives.
 */
export type VoiceState = 'off' | 'idle' | 'speaking';

export type VoiceHost = {
  get: () => ConciergeState;
  patch: (patch: Partial<ConciergeState>) => void;
};

/** The voice part of the chat state, as it starts out. */
export function initialVoiceState(): Pick<
  ConciergeState,
  | 'voice'
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
    voiceNotice: null,
    // On by default: the chat talks back (it only does so where /health reports a server voice). An
    // explicit "sound off" the visitor chose is kept.
    speakEnabled: loadVoicePrefs().speak ?? true,
    speakAvailable: false,
    voiceDisclosed: false,
    blockedReplyId: null,
    readAloudBonus: false,
    bonusCount: DEFAULT_BONUS_REPLIES,
  };
}

export function createVoiceController({ get, patch }: VoiceHost) {
  let prefs: VoicePrefs = loadVoicePrefs();

  /** Whether replies are read aloud (by the server voice); /health decides. 'none' is text only. */
  let ttsMode: 'server' | 'none' = 'none';
  /**
   * The audio the browser would not start (a reply, or the opening greeting), kept so that a tap can
   * play it (no second request).
   */
  let held: { blob: Blob; messageId: string; mode: SpeechMode } | null = null;
  let checked = false;
  /** Voice gave up for this tab (a stored flag from an older visit); a late /health cannot revive it. */
  const blocked = prefs.blocked;
  /** The panel is open and the tab visible: the only time a reply is read aloud. */
  let active = true;
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
   * Ask the Worker once whether it has a server voice. The answer the
   * bubble fetched when the page loaded (for the greeting) is reused rather than asked for again.
   */
  const checkVoice = async (): Promise<void> => {
    if (checked || blocked) return;
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
    cancelQueued(); // a reply waiting behind the greeting goes too
    stopReading();
    if (get().voice === 'speaking') patch({ voice: 'idle' });
  };

  /** The panel was closed or unmounted: the speaker stops. */
  const stopAll = () => {
    stopSpeaking();
    // The read-aloud line was for this first visit to voice; it is not shown a second time.
    if (get().voiceDisclosed) patch({ voiceDisclosed: false });
  };

  /** Whether the panel is open and the tab visible. Replies that land while it is not are not read. */
  const setActive = (value: boolean) => {
    active = value;
  };

  /** Inside a tap on the speaker toggle: let iOS know speech is wanted. */
  const unlock = () => {
    if (ttsMode === 'server') unlockSpeech();
  };

  /** Forget the reply that is waiting for a tap (a newer reply, or sound turned off, replaces it). */
  const clearBlocked = () => {
    held = null;
    if (get().blockedReplyId !== null) patch({ blockedReplyId: null });
  };

  /**
   * Inside the tap that sends a message: when replies will be read aloud and nothing is playing yet (no
   * greeting played), let iOS know speech is wanted, so the first spoken reply can start without a gesture.
   */
  const unlockForSend = () => {
    if (get().speakEnabled && activeSpeechMode() === null) unlock();
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
    if (voice === 'off') return;
    const hooks = {
      fetchAudio: (t: string, signal: AbortSignal) => fetchTts(t, get().sessionId, signal),
      canPlay: () => active, // closed or hidden while the request was out: drop the clip
      onStart: onSpeechStart,
      onEnd: onSpeechEnd,
      onLimit: limitReached,
      onBlocked: (blob: Blob) => audioBlocked(blob, messageId),
    };
    // The greeting is still playing (the automatic question from a section button): the reply waits
    // its turn instead of cutting the greeting off mid-sentence.
    if (activeSpeechMode() === 'greeting' && speakAfterGreeting(text, hooks)) return;
    speak(text, hooks);
  };

  /** The "Tap to hear replies" pill was tapped: play the reply that was waiting, inside this tap. */
  const playBlocked = () => {
    const pending = held;
    if (!pending) return;
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
    unlockForSend,
    stopAll,
    setActive,
    stopSpeaking,
    setSpeakEnabled,
    speakReply,
    playBlocked,
    adoptGreeting,
    noteLeadSubmitted,
  };
}
