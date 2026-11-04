// The one <audio> element, and the rule that one thing is read at a time (voice plan sections 1.2 and 1.4).
//
// This is the small half of the speech code, the part the always-loaded bubble needs: it can start the
// recorded greeting inside the visitor's click and stop it again, before the panel chunk (which holds
// speech.ts: the fetching of replies, the tap-to-hear audio, the iOS unlock) has been downloaded. Both
// halves share this module's state, so a reply started later replaces the greeting, and stopSpeaking()
// ends whichever is playing. Starting another or calling stopSpeaking() ends the one in progress, and
// its callbacks never fire again.

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

// ---- One thing at a time -------------------------------------------------------

export type Run = {
  ended: boolean;
  /** Sound has begun (onStart has been reported). */
  started: boolean;
  mode: SpeechMode;
  /** Stop the underlying audio (does not report). */
  halt: () => void;
  /** Report the end, once. */
  end: () => void;
  /** Who joined the run after it began (the panel, for the greeting); at most one. */
  watcher: SpeechObserver | null;
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

/** The shared element, made on first use (and then used for everything). Throws where there is no Audio. */
export function sharedAudioElement(): HTMLAudioElement {
  sharedAudio ??= new Audio();
  return sharedAudio;
}

/** The run in progress, if any. */
export const activeRun = (): Run | null => active;

/** Stop whatever is being read. Its onEnd fires now; nothing from it fires afterwards. */
export function stopSpeaking(): void {
  generation += 1;
  const run = active;
  active = null;
  if (!run) return;
  run.halt();
  run.end();
}

/** Stop whatever is playing and forget the shared element. For tests. */
export function resetPlayback(): void {
  stopSpeaking();
  sharedAudio = null;
}

/** Begin a run: it becomes the one in progress (anything before it was already stopped by the caller). */
export function newRun(hooks: SpeakHooks): Run {
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
      run.watcher?.onEnd?.();
      run.watcher = null;
    },
    watcher: null,
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
  run.watcher?.onStart?.(run.mode);
}

/**
 * Play `src` on the shared element. A refusal because the browser wants a tap is reported
 * through `whenBlocked`; any other failure just ends the run, which then stays text. `release`
 * frees whatever `src` was made from (an object URL), once, however the run ends.
 */
export function playSource(
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
    audio = sharedAudioElement();
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
    const blob = res.ok ? await res.blob() : null;
    return blob && blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}
