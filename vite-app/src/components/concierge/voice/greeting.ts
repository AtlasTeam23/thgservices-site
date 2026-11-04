// The recorded greeting that plays the instant the chat is opened ("the voice should play
// automatically when the pop-up is clicked").
//
// The text is GREETING in copy.ts; the audio is a static MP3 of it in the Worker's voice
// (public/concierge/greeting.mp3, made once by `npm run eleven:greeting` in concierge-worker, with a
// greeting.json beside it that says what was recorded). Playing it costs nothing: it never calls /tts
// and never counts against any cap.
//
// Timing is the whole difficulty. A browser (iOS Safari above all) lets audio start only inside the
// visitor's click, but the panel and its voice controller sit in a lazy chunk that does not exist yet
// at that moment. So this module lives in the always-loaded bubble and needs nothing but module state
// and sessionStorage: playGreetingOnOpen() decides synchronously and starts the file in the same click,
// and the controller takes the greeting over later through claimGreeting().
//
// "Is the server voice available?" cannot be asked at click time (a click cannot wait for the
// network), so /health is fetched once when the bubble mounts and the answer is read from here.

import { track } from '../../../lib/track';
import { fetchVoiceCaps, type VoiceCaps } from '../api';
import { loadState } from '../storage';
import { isFreshThread } from '../thread';
import { loadVoicePrefs, saveVoicePrefs, spokenCapInForce } from './prefs';
import { speakUrl } from './speech';

/** Where the recording is served from (the site's public/ folder). */
export const GREETING_URL = `${import.meta.env.BASE_URL}concierge/greeting.mp3`;

// ---- Is the server voice there? --------------------------------------------------

/** What /health said about the voice: not in yet (or failed), a server voice, or none. */
let health: 'unknown' | 'server' | 'none' = 'unknown';
/** The one /health request of this page load, in flight or answered. */
let capsRequest: Promise<VoiceCaps | null> | null = null;

const loadCaps = async (): Promise<VoiceCaps | null> => {
  let caps: VoiceCaps | null = null;
  try {
    caps = await fetchVoiceCaps();
  } catch {
    // treated as "no voice"
  }
  // A failure stays "unknown": the greeting only plays when the server voice is positively known.
  if (caps) health = caps.tts;
  return caps;
};

/**
 * Ask the Worker once, when the page loads, whether it has a server voice, so that a click can read
 * the answer. fetchVoiceCaps() has its own timeout (5 s, one retry); until it answers the greeting
 * simply does not play. Safe to call again: only the first call asks.
 */
export function prefetchVoiceCaps(): void {
  capsRequest ??= loadCaps();
}

/**
 * The voice controller's /health check. It reuses the page-load answer instead of asking a second
 * time, and asks for itself only when there is no answer to reuse (nothing was prefetched, or it failed).
 */
export async function voiceCapsOnce(): Promise<VoiceCaps | null> {
  if (capsRequest) {
    const caps = await capsRequest;
    if (caps) return caps;
  }
  return fetchVoiceCaps();
}

// ---- Playing it ------------------------------------------------------------------

/** The greeting has been started in this page load (also covers storage that cannot remember `greeted`). */
let started = false;
/** Whether replies are read aloud, as the click that started the greeting saved it. */
let speakChoice = true;
/** The panel's controller has taken the greeting over (once). */
let claimed = false;
/** The greeting audio, when the browser refused to play it and nobody has claimed it yet. */
let parked: Blob | null = null;
/** Where to send that audio, when the controller claimed the greeting first. */
let waiting: ((blob: Blob) => void) | null = null;

const park = (blob: Blob): void => {
  if (waiting) {
    const deliver = waiting;
    waiting = null;
    deliver(blob);
  } else {
    parked = blob;
  }
};

/**
 * Call this from inside the click (or tap) that opens the chat, before anything is awaited. Plays the
 * greeting when all of these hold, all decided right here from module state and sessionStorage:
 * the server voice is known to be there, this tab has not heard the greeting, the visitor has not turned
 * sound off, today's allowance of spoken replies is not used up, voice has not given up for the
 * session, and nothing has been said in the chat yet. Otherwise it does nothing, silently.
 *
 * Starting it is the visitor's first use of voice: replies are read aloud from here on (under the
 * usual per-visitor cap) and the microphone line is shown.
 */
export function playGreetingOnOpen(): void {
  try {
    if (started || health !== 'server' || typeof Audio === 'undefined') return;
    const prefs = loadVoicePrefs();
    if (prefs.greeted || prefs.speak === false || prefs.blocked || spokenCapInForce(prefs, Date.now())) return;
    if (!isFreshThread(loadState().messages)) return;

    started = true;
    speakChoice = prefs.speak ?? true;
    saveVoicePrefs({ ...prefs, speak: speakChoice, disclosed: true, greeted: true });
    speakUrl(GREETING_URL, {
      mode: 'greeting',
      onStart: (mode) => track('concierge_voice_reply_spoken', { mode }),
      // Without a live gesture the browser said no: the file is kept for the "Tap to hear replies" pill.
      onBlocked: park,
    });
  } catch {
    // Never let the greeting get in the way of opening the chat.
  }
}

/** What the controller takes over: the sound choice the click saved, and the audio if it was refused. */
export type GreetingClaim = {
  /** Whether replies are read aloud (the click saved speak: this, disclosed: true, greeted: true). */
  speak: boolean;
  /** The greeting's audio, if the browser has already refused to play it (for the "Tap to hear" pill). */
  blob: Blob | null;
};

/**
 * The panel's voice controller takes the greeting over, once it exists. Returns null when no greeting was
 * started in this page load (or it was taken already). If the browser refuses the audio later than this,
 * `onBlocked` receives it whenever it arrives.
 */
export function claimGreeting(onBlocked: (blob: Blob) => void): GreetingClaim | null {
  if (!started || claimed) return null;
  claimed = true;
  const blob = parked;
  parked = null;
  if (!blob) waiting = onBlocked;
  return { speak: speakChoice, blob };
}

/** Forget everything, as if the page had just loaded. For tests. */
export function resetGreeting(): void {
  health = 'unknown';
  capsRequest = null;
  started = false;
  speakChoice = true;
  claimed = false;
  parked = null;
  waiting = null;
}
