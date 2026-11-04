// Reading replies aloud (voice plan sections 1.2 and 1.4).
//
// There is one voice: audio fetched from the Worker's /tts and played in an <audio> element.
// There is no browser voice, so when the server cannot deliver the reply simply stays text. If
// the browser blocks playback until the visitor taps, the audio is handed back so a tap can
// play it (see speakBlob). One reply is spoken at a time; starting another or calling
// stopSpeaking() ends the one in progress, and its callbacks never fire again.

/** Where a reply's sound came from (reported to analytics). */
export type SpeechMode = 'server';

/** What the server voice returned for a reply. Structurally the same as api.ts's TtsResult. */
export type AudioResult =
  | { kind: 'ok'; blob: Blob }
  | { kind: 'limit'; bonusAvailable: boolean; bonus?: number }
  | { kind: 'unavailable' };

export type SpeakHooks = {
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
   * tap can play it with speakBlob().
   */
  onBlocked?: (blob: Blob) => void;
};

/** The Worker's /tts limit (the same as a reply's); a longer reply is not spoken. */
export const SERVER_MAX_CHARS = 1000;

// A WAV header with no samples: plays and ends at once. Played during the first tap
// so iOS lets the shared <audio> element play later without a gesture.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

// ---- One reply at a time -------------------------------------------------------

type Run = {
  ended: boolean;
  /** Stop the underlying audio (does not report). */
  halt: () => void;
  /** Report the end, once. */
  end: () => void;
};

let active: Run | null = null;

/**
 * The one <audio> element for server audio, created by unlockSpeech() or by the first play
 * from inside a tap. Reused for every reply: on iOS, an element a gesture has played on stays
 * allowed to play later, and a fresh element would not be.
 */
let sharedAudio: HTMLAudioElement | null = null;

/** Stop whatever is being read. Its onEnd fires now; nothing from it fires afterwards. */
export function stopSpeaking(): void {
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
    halt: () => {},
    end: () => {
      if (run.ended) return;
      run.ended = true;
      if (active === run) active = null;
      hooks.onEnd?.();
    },
  };
  active = run;
  return run;
}

/**
 * Play audio on the shared element. A refusal because the browser wants a tap is reported
 * through `onBlocked` (with the audio, so a tap can play it); any other failure just ends the
 * reply, which then stays text.
 */
function playBlob(run: Run, blob: Blob, hooks: SpeakHooks): void {
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
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
    if (url) {
      URL.revokeObjectURL(url);
      url = null;
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
    url = URL.createObjectURL(blob);
    audio.src = url;
    audio.onended = () => {
      if (!run.ended) giveUp();
    };
    audio.onerror = () => {
      if (!run.ended) giveUp();
    };
    audio.play().then(
      () => {
        if (!run.ended) hooks.onStart?.('server');
      },
      (error: unknown) => {
        if (run.ended) return;
        const blocked = (error as { name?: string } | null)?.name === 'NotAllowedError';
        cleanup();
        if (blocked) hooks.onBlocked?.(blob);
        run.end();
      }
    );
  } catch {
    if (!run.ended) giveUp();
  }
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
