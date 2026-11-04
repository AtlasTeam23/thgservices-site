// Reading replies aloud (voice plan sections 1.2 and 1.4).
//
// Two voices, and /health decides which one a visit gets, never both:
//  - 'browser': the browser's own speechSynthesis (free, instant).
//  - 'server': audio fetched from the Worker's /tts, played in an <audio> element. If the
//    server cannot deliver, the reply stays text; the browser voice does not step in. If the
//    browser blocks playback until the visitor taps, the audio is handed back so a tap can
//    play it (see speakBlob).
// One reply is spoken at a time; starting another or calling stopSpeaking() ends the one in
// progress, and its callbacks never fire again.

export type SpeechMode = 'browser' | 'server';

/** What the server voice returned for a reply. Structurally the same as api.ts's TtsResult. */
export type AudioResult =
  | { kind: 'ok'; blob: Blob }
  | { kind: 'limit'; bonusAvailable: boolean }
  | { kind: 'unavailable' };

export type SpeakHooks = {
  /** Server voice only: fetch the audio for this text. */
  fetchAudio?: (text: string) => Promise<AudioResult>;
  /** Sound has begun. */
  onStart?: (mode: SpeechMode) => void;
  /** Finished, stopped, or failed. Called exactly once per speak(). */
  onEnd?: () => void;
  /** Server voice only: the daily allowance of spoken replies is used up. No sound follows. */
  onLimit?: (bonusAvailable: boolean) => void;
  /**
   * Server voice only: the browser would not start the audio without a tap. The audio is
   * handed over so that a tap can play it with speakBlob().
   */
  onBlocked?: (blob: Blob) => void;
};

/** The Worker's /tts limit (the same as a reply's); a longer reply is not spoken. */
export const SERVER_MAX_CHARS = 1000;

/**
 * Chrome's network voices cut an utterance off after about 15 seconds, so a reply
 * is queued as several sentence-sized pieces.
 */
const CHUNK_CHARS = 200;

/** Voices that sound best on the platforms we care about, best first. */
const PREFERRED_VOICES = ['Samantha', 'Ava', 'Google US English'];

// A WAV header with no samples: plays and ends at once. Played during the first tap
// so iOS lets the shared <audio> element play later without a gesture.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

export const isSpeechSupported = (): boolean =>
  typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

const isEnglish = (v: SpeechSynthesisVoice) => /^en([-_]|$)/i.test(v.lang);
const isUS = (v: SpeechSynthesisVoice) => /^en[-_]US$/i.test(v.lang);

/**
 * Lower is better. A voice that runs on the device always beats a network one: it starts at
 * once, does not get cut off after 15 seconds in Chrome, and the text never leaves the device.
 */
function rank(v: SpeechSynthesisVoice): number {
  const tier = (): number => {
    const named = PREFERRED_VOICES.findIndex((n) => v.name.includes(n));
    if (named >= 0) return named;
    if (isUS(v)) return v.default ? 10 : 11;
    return v.default ? 20 : 21;
  };
  return (v.localService ? 0 : 100) + tier();
}

/** The nicest English voice on offer, or null to let the browser use its default. */
export function pickVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null;
  for (const v of voices) {
    if (!isEnglish(v)) continue;
    if (best === null || rank(v) < rank(best)) best = v;
  }
  return best;
}

function breakAtSpaces(sentence: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (let word of sentence.split(' ')) {
    while (word.length > max) {
      if (line) {
        out.push(line);
        line = '';
      }
      out.push(word.slice(0, max));
      word = word.slice(max);
    }
    if (line && line.length + 1 + word.length > max) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

/** Pieces of at most `max` characters, cut at sentence ends where possible. */
export function splitForSpeech(text: string, max = CHUNK_CHARS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  // A sentence ends at ./!/? only when whitespace (or the end) follows, so "$3.50", "8 a.m. to",
  // "thg.com/ai" and "2.0" are not cut. Lookahead only: lookbehind is missing from older Safari.
  const sentences = clean.match(/.+?(?:[.!?]+['")\]]*(?=\s|$)|$)/g) ?? [clean];

  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    if (current) chunks.push(current);
    current = '';
  };
  for (const raw of sentences) {
    const piece = raw.trim();
    if (!piece) continue;
    if (piece.length > max) {
      flush();
      chunks.push(...breakAtSpaces(piece, max));
      continue;
    }
    if (current && current.length + 1 + piece.length > max) flush();
    current = current ? `${current} ${piece}` : piece;
  }
  flush();
  return chunks;
}

// ---- One reply at a time -------------------------------------------------------

type Run = {
  ended: boolean;
  /** Stop the underlying voice or audio (does not report). */
  halt: () => void;
  /** Report the end, once. */
  end: () => void;
  /**
   * The utterances queued for this reply. Chrome stops firing events on an utterance that has
   * been garbage collected, so they are kept here until the reply ends.
   */
  held: SpeechSynthesisUtterance[];
};

let active: Run | null = null;

/** How many utterances the current reply is holding on to. For tests. */
export const heldUtteranceCount = (): number => active?.held.length ?? 0;
/**
 * The one <audio> element for server audio, created by unlockSpeech('server') or by the first
 * play from inside a tap. Reused for every reply: on iOS, an element a gesture has played on
 * stays allowed to play later, and a fresh element would not be.
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
 * Call from inside the first tap or click. iOS only lets speechSynthesis (and
 * <audio>) run later, from a timer or a network callback, once something has been
 * started during a gesture.
 */
export function unlockSpeech(mode: SpeechMode = 'browser'): void {
  if (mode === 'browser' && isSpeechSupported()) {
    try {
      const utterance = new SpeechSynthesisUtterance('');
      utterance.volume = 0;
      speechSynthesis.speak(utterance);
      // Chrome only starts loading its voice list when asked; ask now, so the list is there
      // by the time the first reply is spoken.
      speechSynthesis.getVoices();
    } catch {
      // not allowed here; the next gesture will do
    }
  }
  if (mode === 'server' && typeof Audio !== 'undefined') {
    try {
      sharedAudio ??= new Audio();
      sharedAudio.src = SILENT_WAV;
      void sharedAudio.play().catch(() => {});
    } catch {
      // as above
    }
  }
}

function newRun(hooks: SpeakHooks): Run {
  const run: Run = {
    ended: false,
    halt: () => {},
    held: [],
    end: () => {
      if (run.ended) return;
      run.ended = true;
      run.held = [];
      if (active === run) active = null;
      hooks.onEnd?.();
    },
  };
  active = run;
  return run;
}

function startBrowser(run: Run, text: string, hooks: SpeakHooks): void {
  if (!isSpeechSupported()) {
    run.end();
    return;
  }
  run.halt = () => {
    try {
      speechSynthesis.cancel();
    } catch {
      // nothing to cancel
    }
  };
  try {
    speechSynthesis.cancel(); // also clears anything left queued, such as the unlock utterance
    const voice = pickVoice(speechSynthesis.getVoices());
    const pieces = splitForSpeech(text);
    let started = false;
    pieces.forEach((piece, i) => {
      const utterance = new SpeechSynthesisUtterance(piece);
      utterance.lang = 'en-US';
      if (voice) utterance.voice = voice;
      if (i === 0) {
        utterance.onstart = () => {
          if (run.ended || started) return;
          started = true;
          hooks.onStart?.('browser');
        };
      }
      if (i === pieces.length - 1) utterance.onend = () => run.end();
      utterance.onerror = () => {
        if (run.ended) return;
        run.halt();
        run.end();
      };
      run.held.push(utterance);
      speechSynthesis.speak(utterance);
    });
  } catch {
    run.end();
  }
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

function startServer(run: Run, text: string, hooks: SpeakHooks): void {
  const { fetchAudio } = hooks;
  if (!fetchAudio || text.length > SERVER_MAX_CHARS) {
    run.end();
    return;
  }
  fetchAudio(text).then(
    (result) => {
      if (run.ended) return;
      if (result.kind === 'limit') {
        hooks.onLimit?.(result.bonusAvailable);
        run.end();
      } else if (result.kind === 'ok') {
        playBlob(run, result.blob, hooks);
      } else {
        run.end();
      }
    },
    () => {
      if (!run.ended) run.end();
    }
  );
}

export function speak(text: string, mode: SpeechMode, hooks: SpeakHooks = {}): void {
  stopSpeaking();
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) {
    hooks.onEnd?.();
    return;
  }
  const run = newRun(hooks);
  if (mode === 'server') startServer(run, clean, hooks);
  else startBrowser(run, clean, hooks);
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
