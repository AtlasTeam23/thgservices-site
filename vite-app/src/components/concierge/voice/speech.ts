// Reading replies aloud (voice plan sections 1.2 and 1.4).
//
// Default: the browser's own speechSynthesis (free, instant). With the premium
// voice on (`tts: 'aura'` in /health) the audio comes from the Worker instead and
// plays in an <audio> element, falling back to the browser voice whenever the
// server cannot deliver. One reply is spoken at a time; starting another or
// calling stopSpeaking() ends the one in progress, and its callbacks never fire
// again.

export type SpeechMode = 'browser' | 'aura';

export type SpeakHooks = {
  /** Premium voice only: fetch the audio for this text; null when it is not available. */
  fetchAudio?: (text: string) => Promise<Blob | null>;
  /** Sound has begun. Reports the voice actually used (the premium voice can fall back). */
  onStart?: (mode: SpeechMode) => void;
  /** Finished, stopped, or failed. Called exactly once per speak(). */
  onEnd?: () => void;
};

/** The Worker's /tts limit (the same as a reply's); anything longer is read by the browser voice. */
export const AURA_MAX_CHARS = 1000;

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
/** The <audio> element primed by unlockSpeech('aura'); reused so iOS keeps allowing it. */
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
  if (isSpeechSupported()) {
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
  if (mode === 'aura' && typeof Audio !== 'undefined') {
    try {
      sharedAudio ??= new Audio();
      sharedAudio.src = SILENT_WAV;
      void sharedAudio.play().catch(() => {});
    } catch {
      // as above
    }
  }
}

export function speak(text: string, mode: SpeechMode, hooks: SpeakHooks = {}): void {
  stopSpeaking();
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) {
    hooks.onEnd?.();
    return;
  }

  let ended = false;
  const run: Run = {
    halt: () => {},
    end: () => {
      if (ended) return;
      ended = true;
      run.held = [];
      if (active === run) active = null;
      hooks.onEnd?.();
    },
    held: [],
  };
  active = run;

  const startBrowser = () => {
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
      const pieces = splitForSpeech(clean);
      let started = false;
      pieces.forEach((piece, i) => {
        const utterance = new SpeechSynthesisUtterance(piece);
        utterance.lang = 'en-US';
        if (voice) utterance.voice = voice;
        if (i === 0) {
          utterance.onstart = () => {
            if (ended || started) return;
            started = true;
            hooks.onStart?.('browser');
          };
        }
        if (i === pieces.length - 1) utterance.onend = () => run.end();
        utterance.onerror = () => {
          if (ended) return;
          run.halt();
          run.end();
        };
        run.held.push(utterance);
        speechSynthesis.speak(utterance);
      });
    } catch {
      run.end();
    }
  };

  const startAura = (fetchAudio: (text: string) => Promise<Blob | null>) => {
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
    const fallBack = () => {
      cleanup();
      run.halt = () => {};
      startBrowser();
    };
    run.halt = cleanup;

    fetchAudio(clean).then(
      (blob) => {
        if (ended) return;
        if (!blob) {
          fallBack();
          return;
        }
        try {
          audio = sharedAudio ?? new Audio();
          url = URL.createObjectURL(blob);
          audio.src = url;
          audio.onended = () => {
            if (ended) return;
            cleanup();
            run.end();
          };
          audio.onerror = () => {
            if (!ended) fallBack();
          };
          audio.play().then(
            () => {
              if (!ended) hooks.onStart?.('aura');
            },
            () => {
              if (!ended) fallBack();
            }
          );
        } catch {
          if (!ended) fallBack();
        }
      },
      () => {
        if (!ended) fallBack();
      }
    );
  };

  if (mode === 'aura' && hooks.fetchAudio && clean.length <= AURA_MAX_CHARS) {
    startAura(hooks.fetchAudio);
  } else {
    startBrowser();
  }
}
