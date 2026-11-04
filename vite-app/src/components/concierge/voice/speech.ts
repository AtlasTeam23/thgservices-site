// Reading replies aloud (voice plan sections 1.2 and 1.4).
//
// There is one voice: audio fetched from the Worker's /tts and played in an <audio> element.
// There is no browser voice, so when the server cannot deliver the reply simply stays text. If
// the browser blocks playback until the visitor taps, the audio is handed back so a tap can
// play it (see speakBlob). One reply is spoken at a time; starting another or calling
// stopSpeaking() ends the one in progress, and its callbacks never fire again.
//
// The one other thing played here is the recorded opening greeting, a static MP3 played from a URL
// (speakUrl). It runs on the same shared element, so it is replaced, stopped and reported like a reply.

/** Where a reply's sound came from (reported to analytics): the server voice, or the recorded greeting. */
export type SpeechMode = 'server' | 'greeting';

/** What the server voice returned for a reply. Structurally the same as api.ts's TtsResult. */
export type AudioResult =
  | { kind: 'ok'; blob: Blob }
  | { kind: 'limit'; bonusAvailable: boolean; bonus?: number }
  | { kind: 'unavailable' };

export type SpeakHooks = {
  /** What `onStart` reports (and analytics records). Default 'server'. */
  mode?: SpeechMode;
  /**
   * Fetch the audio for this text. The signal is aborted when the reply is no longer wanted
   * (stopped, replaced, the panel closed), so the request can be cancelled.
   */
  fetchAudio?: (text: string, signal: AbortSignal) => Promise<AudioResult>;
  /**
   * Asked once the audio has arrived, just before it would play: false drops it (the panel was
   * closed or the tab hidden while the request was out), and nothing is played or offered.
   */
  canPlay?: () => boolean;
  /** Sound has begun. */
  onStart?: (mode: SpeechMode) => void;
  /** Finished, stopped, or failed. Called exactly once per speak(). */
  onEnd?: () => void;
  /** The daily allowance of spoken replies is used up. No sound follows. */
  onLimit?: (bonusAvailable: boolean, bonus?: number) => void;
  /**
   * The browser would not start the audio without a tap. The audio is handed over so that a
   * tap can play it with speakBlob(). (For speakUrl the file is fetched first, so this can
   * arrive a moment after the refusal, and not at all if speech was stopped or replaced meanwhile.)
   */
  onBlocked?: (blob: Blob) => void;
};

/** Hooks for something that joins a run already in progress (see watchSpeech). */
export type SpeechObserver = Pick<SpeakHooks, 'onStart' | 'onEnd'>;

/** The Worker's /tts limit (the same as a reply's); a longer reply is not spoken. */
export const SERVER_MAX_CHARS = 1000;

// A WAV header with no samples: plays and ends at once. Played during the first tap
// so iOS lets the shared <audio> element play later without a gesture.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

// ---- One reply at a time -------------------------------------------------------

type Run = {
  ended: boolean;
  /** Sound has begun (onStart has been reported). */
  started: boolean;
  mode: SpeechMode;
  /** Stop the underlying audio (does not report). */
  halt: () => void;
  /** Report the end, once. */
  end: () => void;
  /** Observers that joined after the run began. */
  watchers: Set<SpeechObserver>;
};

let active: Run | null = null;

/**
 * Bumped whenever speech starts or is stopped. Work that finishes later (the greeting file fetched
 * for a tap) compares it with the value it began under, and drops itself if anything happened since.
 */
let generation = 0;

/**
 * The one <audio> element for server audio, created by unlockSpeech() or by the first play
 * from inside a tap. Reused for every reply: on iOS, an element a gesture has played on stays
 * allowed to play later, and a fresh element would not be.
 */
let sharedAudio: HTMLAudioElement | null = null;

/** Stop whatever is being read. Its onEnd fires now; nothing from it fires afterwards. */
export function stopSpeaking(): void {
  generation += 1;
  const run = active;
  active = null;
  if (!run) return;
  run.halt();
  run.end();
}

/** Full teardown, including the primed audio element. For tests. */
export function resetSpeech(): void {
  stopSpeaking();
  sharedAudio = null;
}

/**
 * Call from inside the first tap or click, without awaiting anything first. iOS only lets
 * <audio> play later, from a timer or a network callback, once the element has been played
 * during a gesture.
 */
export function unlockSpeech(): void {
  if (typeof Audio === 'undefined') return;
  try {
    sharedAudio ??= new Audio();
    sharedAudio.src = SILENT_WAV;
    void sharedAudio.play().catch(() => {});
  } catch {
    // not allowed here; the next gesture will do
  }
}

function newRun(hooks: SpeakHooks): Run {
  const run: Run = {
    ended: false,
    started: false,
    mode: hooks.mode ?? 'server',
    halt: () => {},
    end: () => {
      if (run.ended) return;
      run.ended = true;
      if (active === run) active = null;
      hooks.onEnd?.();
      for (const watcher of run.watchers) watcher.onEnd?.();
      run.watchers.clear();
    },
    watchers: new Set(),
  };
  generation += 1;
  active = run;
  return run;
}

/** Sound has begun: tell the run's own hooks, then anyone who joined it. */
function reportStart(run: Run, hooks: SpeakHooks): void {
  if (run.ended) return;
  run.started = true;
  hooks.onStart?.(run.mode);
  for (const watcher of run.watchers) watcher.onStart?.(run.mode);
}

/**
 * Join the run in progress without owning it, for a part of the app that did not exist when it began
 * (the panel, when the greeting was started by the click that opened it). `onStart` is called at
 * once if sound has already begun, then `onEnd` when the run finishes or is stopped. With `mode`, only
 * a run of that kind is joined. Returns false when there was nothing to join.
 */
export function watchSpeech(observer: SpeechObserver, mode?: SpeechMode): boolean {
  const run = active;
  if (!run || run.ended || (mode !== undefined && run.mode !== mode)) return false;
  run.watchers.add(observer);
  if (run.started) observer.onStart?.(run.mode);
  return true;
}

/**
 * Play `src` on the shared element. A refusal because the browser wants a tap is reported
 * through `whenBlocked`; any other failure just ends the run, which then stays text. `release`
 * frees whatever `src` was made from (an object URL), once, however the run ends.
 */
function playSource(
  run: Run,
  src: string,
  hooks: SpeakHooks,
  release: (() => void) | null,
  whenBlocked: () => void
): void {
  let audio: HTMLAudioElement | null = null;
  let free = release;
  const cleanup = () => {
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
      } catch {
        // not playing
      }
    }
    if (free) {
      free();
      free = null;
    }
  };
  const giveUp = () => {
    cleanup();
    run.end();
  };
  run.halt = cleanup;

  try {
    sharedAudio ??= new Audio();
    audio = sharedAudio;
    audio.src = src;
    audio.onended = () => {
      if (!run.ended) giveUp();
    };
    audio.onerror = () => {
      if (!run.ended) giveUp();
    };
    audio.play().then(
      () => reportStart(run, hooks),
      (error: unknown) => {
        if (run.ended) return;
        const blocked = (error as { name?: string } | null)?.name === 'NotAllowedError';
        cleanup();
        if (blocked) whenBlocked();
        run.end();
      }
    );
  } catch {
    if (!run.ended) giveUp();
  }
}

/** Play fetched audio (an object URL made from the blob, revoked when the run is over). */
function playBlob(run: Run, blob: Blob, hooks: SpeakHooks): void {
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

/** Fetch the audio for a reply and play it. Anything that goes wrong leaves the reply as text. */
export function speak(text: string, hooks: SpeakHooks = {}): void {
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
  stopSpeaking();
  playBlob(newRun(hooks), blob, hooks);
}

/**
 * Play a file the site serves (the recorded greeting). Call it straight from the click, without
 * awaiting anything first: `src` is set and play() reached before this returns, so iOS counts the
 * click as the gesture, and the shared element it unlocks stays unlocked for the replies that follow.
 * It is one reply like any other: a newer speak(), speakBlob() or stopSpeaking() ends it.
 *
 * If the browser refuses without a gesture, the file is fetched and handed over through `onBlocked`
 * (so a tap can play it with speakBlob), unless speech was stopped or replaced in the meantime.
 * Any other failure ends the run quietly.
 */
export function speakUrl(url: string, hooks: SpeakHooks = {}): void {
  stopSpeaking();
  const run = newRun(hooks);
  const began = generation;
  playSource(run, url, hooks, null, () => {
    const { onBlocked } = hooks;
    if (!onBlocked) return;
    void fetchBlob(url).then((blob) => {
      if (blob && generation === began) onBlocked(blob);
    });
  });
}

/** The file as a Blob, or null if it cannot be had (a missing file is not worth a notice). */
async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}
