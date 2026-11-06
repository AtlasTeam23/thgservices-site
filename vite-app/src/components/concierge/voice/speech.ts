// Reading replies aloud (voice plan sections 1.2 and 1.4).
//
// There is one voice: audio fetched from the Worker's /tts and played in an <audio> element.
// There is no browser voice, so when the server cannot deliver the reply simply stays text. If
// the browser blocks playback until the visitor taps, the audio is handed back so a tap can
// play it (see speakBlob). One reply is spoken at a time; starting another or calling
// stopSpeaking() ends the one in progress, and its callbacks never fire again.
//
// This is the panel's half. The element and the one-at-a-time rule are in playback.ts, which the
// always-loaded bubble also uses (it starts the recorded greeting inside the click, before this
// file has been downloaded); what is re-exported below is that shared half.

import {
  activeRun,
  newRun,
  playSource,
  resetPlayback,
  sharedAudioElement,
  stopSpeaking,
  type SpeakHooks,
  type SpeechMode,
  type SpeechObserver,
} from './playback';

export { speakUrl, stopSpeaking } from './playback';
export type { AudioResult, SpeakHooks, SpeechMode, SpeechObserver } from './playback';

/** The Worker's /tts limit (the same as a reply's); a longer reply is not spoken. */
export const SERVER_MAX_CHARS = 1000;

// A WAV header with no samples: plays and ends at once. Played during the first tap
// so iOS lets the shared <audio> element play later without a gesture.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

/** Full teardown, including the primed audio element. For tests. */
export const resetSpeech = resetPlayback;

/**
 * Call from inside the first tap or click, without awaiting anything first. iOS only lets
 * <audio> play later, from a timer or a network callback, once the element has been played
 * during a gesture.
 */
export function unlockSpeech(): void {
  if (typeof Audio === 'undefined') return;
  try {
    const audio = sharedAudioElement();
    audio.src = SILENT_WAV;
    void audio.play().catch(() => {});
  } catch {
    // not allowed here; the next gesture will do
  }
}

/** What kind of thing is being played right now (the server voice, or the greeting), or null for nothing. */
export function activeSpeechMode(): SpeechMode | null {
  const run = activeRun();
  return run && !run.ended ? run.mode : null;
}

/**
 * Join the run in progress without owning it, for a part of the app that did not exist when it began
 * (the panel, when the greeting was started by the click that opened it). `onStart` is called at
 * once if sound has already begun, then `onEnd` when the run finishes or is stopped. With `mode`, only
 * a run of that kind is joined. A run has room for one such observer (a second replaces the first).
 * Returns false when there was nothing to join.
 */
export function watchSpeech(observer: SpeechObserver, mode?: SpeechMode): boolean {
  const run = activeRun();
  if (!run || run.ended || (mode !== undefined && run.mode !== mode)) return false;
  run.watcher = observer;
  if (run.started) observer.onStart?.(run.mode);
  return true;
}

/** Play fetched audio (an object URL made from the blob, revoked when the run is over). */
function playBlob(run: ReturnType<typeof newRun>, blob: Blob, hooks: SpeakHooks): void {
  let url: string | null = null;
  try {
    url = URL.createObjectURL(blob);
  } catch {
    run.end();
    return;
  }
  const made = url;
  playSource(run, made, hooks, () => URL.revokeObjectURL(made), () => hooks.onBlocked?.(blob));
}

/** The one reply waiting for the greeting to finish (its audio is fetched meanwhile). */
type Queued = {
  cancelled: boolean;
  abort: AbortController;
  blob: Blob | null;
  greetingDone: boolean;
};
let queued: Queued | null = null;

/** Forget the reply waiting behind the greeting: its request is cancelled and it will never play. */
export function cancelQueued(): void {
  const entry = queued;
  queued = null;
  if (!entry) return;
  entry.cancelled = true;
  entry.abort.abort();
}

/**
 * A reply that arrived while the recorded greeting is still playing. The greeting is not cut off:
 * the reply's audio is fetched now, so it is ready, and played as soon as the greeting ends (or at once
 * if the greeting fails). One slot: a newer reply replaces a waiting one, and anything that stops
 * speech on purpose (cancelQueued, which stopSpeaking callers use) drops it. Returns false when the
 * greeting is not what is playing, and the caller should speak() as usual.
 */
export function speakAfterGreeting(text: string, hooks: SpeakHooks = {}): boolean {
  const run = activeRun();
  if (!run || run.ended || run.mode !== 'greeting') return false;
  cancelQueued();
  const clean = text.replace(/\s+/g, ' ').trim();
  const { fetchAudio } = hooks;
  if (!clean || !fetchAudio || clean.length > SERVER_MAX_CHARS) return true; // nothing to say: stays text
  const entry: Queued = { cancelled: false, abort: new AbortController(), blob: null, greetingDone: false };
  queued = entry;
  const finish = () => {
    if (queued === entry) queued = null;
  };
  const tryPlay = () => {
    if (entry.cancelled || !entry.blob || !entry.greetingDone) return;
    finish();
    if (hooks.canPlay && !hooks.canPlay()) return;
    playBlob(newRun(hooks), entry.blob, hooks);
  };
  run.onFinish = () => {
    entry.greetingDone = true;
    tryPlay();
  };
  fetchAudio(clean, entry.abort.signal).then(
    (result) => {
      if (entry.cancelled) return;
      if (result.kind === 'ok') {
        entry.blob = result.blob;
        tryPlay();
      } else {
        if (result.kind === 'limit') hooks.onLimit?.(result.bonusAvailable, result.bonus);
        finish();
      }
    },
    () => {
      if (!entry.cancelled) finish();
    }
  );
  return true;
}

/** Fetch the audio for a reply and play it. Anything that goes wrong leaves the reply as text. */
export function speak(text: string, hooks: SpeakHooks = {}): void {
  cancelQueued();
  stopSpeaking();
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) {
    hooks.onEnd?.();
    return;
  }
  const run = newRun(hooks);
  const { fetchAudio } = hooks;
  if (!fetchAudio || clean.length > SERVER_MAX_CHARS) {
    run.end();
    return;
  }
  const request = new AbortController();
  run.halt = () => request.abort();
  fetchAudio(clean, request.signal).then(
    (result) => {
      if (run.ended) return;
      if (result.kind === 'limit') {
        hooks.onLimit?.(result.bonusAvailable, result.bonus);
        run.end();
      } else if (result.kind === 'ok') {
        if (hooks.canPlay && !hooks.canPlay()) run.end();
        else playBlob(run, result.blob, hooks);
      } else {
        run.end();
      }
    },
    () => {
      if (!run.ended) run.end();
    }
  );
}

/**
 * Play server audio we already have. Call it straight from the tap: play() is reached before
 * this returns, so iOS still counts the tap as the gesture, and what the tap unlocks (the shared
 * element) stays unlocked for the replies that follow.
 */
export function speakBlob(blob: Blob, hooks: SpeakHooks = {}): void {
  cancelQueued();
  stopSpeaking();
  playBlob(newRun(hooks), blob, hooks);
}
