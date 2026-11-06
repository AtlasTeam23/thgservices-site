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
// network), so /health is read once after the page loads (health.ts) and the answer is read from there.
// Everything this file imports is small on purpose: it is part of the main bundle.

import { track } from '../../../lib/track';
import { isFreshThread, loadState } from '../storage';
import { spokenCapInForce, VOICE_PREFS_KEY } from './cap';
import { prefetchVoiceCaps, resetVoiceHealth, voiceHealth } from './health';
import { speakUrl } from './playback';

/** Where the recording is served from (the site's public/ folder). */
export const GREETING_URL = `${import.meta.env.BASE_URL}concierge/greeting.mp3`;

/** The greeting has been started in this page load (also covers storage that cannot remember `greeted`). */
let started = false;
/** The panel's controller has taken the greeting over (once). */
let claimed = false;
/** The greeting audio, once the browser has refused to play it: parked until the controller claims it. */
let parked: Blob | null = null;
/** Where the audio goes if the controller claimed the greeting before the refusal came. */
let deliver: ((blob: Blob) => void) | null = null;

const park = (blob: Blob): void => {
  if (deliver) deliver(blob);
  else parked = blob;
};

/**
 * The stored voice preferences as plain JSON, not sanitised: this file is part of the main bundle, where
 * prefs.ts (reading and writing the whole set; it belongs to the panel chunk) must not be. The greeting reads
 * the few flags it needs and writes back everything it found, plus its own three.
 */
function storedPrefs(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(VOICE_PREFS_KEY) ?? 'null');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Call this from inside the click (or tap) that opens the chat, before anything is awaited. Plays the
 * greeting when all of these hold, all decided right here from module state and sessionStorage:
 * /health said the server voice is there, this tab has not heard the greeting, the visitor has not turned sound off,
 * today's allowance of spoken replies is not used up, voice has not given up for the session, and nothing
 * has been said in the chat yet. Otherwise it does nothing, silently.
 *
 * Starting it is the visitor's first use of voice: replies are read aloud from here on (under the
 * usual per-visitor cap) and the read-aloud line is shown.
 */
export function playGreetingOnOpen(): void {
  try {
    if (started || typeof Audio === 'undefined') return;
    const health = voiceHealth();
    if (health === 'unknown') {
      // The answer is not in (the page was just loaded, or the request failed): ask again now, so
      // that a later open can play it. This click goes without. (A Worker that answered "no voice" is
      // not "unknown": nothing asks it again.)
      prefetchVoiceCaps();
      return;
    }
    if (health !== 'server') return;
    const prefs = storedPrefs();
    const cap = {
      spokenLimit: prefs.spokenLimit === true,
      spokenLimitAt: typeof prefs.spokenLimitAt === 'number' ? prefs.spokenLimitAt : null,
    };
    if (prefs.greeted === true || prefs.speak === false || prefs.blocked === true) return;
    if (spokenCapInForce(cap, Date.now()) || !isFreshThread(loadState().messages)) return;

    started = true;
    const first = { ...prefs, speak: true, disclosed: true, greeted: true };
    try {
      window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(first));
    } catch {
      // storage disabled or full; `started` still keeps it from playing twice in this page load
    }
    speakUrl(GREETING_URL, {
      mode: 'greeting',
      // Not a spoken reply: it has its own event, so reply counts stay replies.
      onStart: () => track('concierge_greeting_played'),
      // Without a live gesture the browser said no: the file is kept for the "Tap to hear replies" pill.
      onBlocked: park,
    });
  } catch {
    // Never let the greeting get in the way of opening the chat.
  }
}

/**
 * The panel's voice controller takes the greeting over, once it exists. Returns null when no greeting was
 * started in this page load (or it was taken already); otherwise an object holding the greeting's audio if the
 * browser has already refused to play it (for the "Tap to hear" pill). If the refusal comes later than this,
 * `onBlocked` receives the audio whenever it arrives. The click saved speak: true, disclosed: true and
 * greeted: true, which the controller takes over too.
 */
export function claimGreeting(onBlocked: (blob: Blob) => void): { blob: Blob | null } | null {
  if (!started || claimed) return null;
  claimed = true;
  const blob = parked;
  parked = null;
  deliver = onBlocked;
  return { blob };
}

/** Forget everything, as if the page had just loaded. For tests. */
export function resetGreeting(): void {
  started = false;
  claimed = false;
  parked = null;
  deliver = null;
  resetVoiceHealth();
}
