import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  heldUtteranceCount,
  isSpeechSupported,
  pickVoice,
  resetSpeech,
  SERVER_MAX_CHARS,
  speak,
  speakBlob,
  splitForSpeech,
  stopSpeaking,
  unlockSpeech,
} from '../voice/speech';

// ---- Fakes -------------------------------------------------------------------

class FakeUtterance {
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  rate = 1;
  volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}

const voice = (name: string, lang: string, extra: Partial<SpeechSynthesisVoice> = {}) =>
  ({ name, lang, default: false, localService: true, voiceURI: name, ...extra }) as SpeechSynthesisVoice;

let spoken: FakeUtterance[];
let voices: SpeechSynthesisVoice[];
let synth: {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  getVoices: ReturnType<typeof vi.fn>;
};

class FakeAudio {
  static instances: FakeAudio[] = [];
  static playImpl: () => Promise<void> = async () => {};
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(() => FakeAudio.playImpl());
  pause = vi.fn();
  constructor() {
    FakeAudio.instances.push(this);
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  spoken = [];
  voices = [];
  synth = {
    speak: vi.fn((u: FakeUtterance) => {
      spoken.push(u);
    }),
    cancel: vi.fn(),
    getVoices: vi.fn(() => voices),
  };
  FakeAudio.instances = [];
  FakeAudio.playImpl = async () => {};
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('Audio', FakeAudio);
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  resetSpeech();
  vi.unstubAllGlobals();
});

// ---- Pure helpers ------------------------------------------------------------

describe('isSpeechSupported', () => {
  it('needs both speechSynthesis and SpeechSynthesisUtterance', () => {
    expect(isSpeechSupported()).toBe(true);
    vi.stubGlobal('speechSynthesis', undefined);
    expect(isSpeechSupported()).toBe(false);
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', undefined);
    expect(isSpeechSupported()).toBe(false);
  });
});

describe('pickVoice', () => {
  it('prefers Samantha, then Ava, then Google US English', () => {
    const list = [
      voice('Google US English', 'en-US'),
      voice('Ava (Enhanced)', 'en-US'),
      voice('Zoe', 'en-US'),
      voice('Samantha', 'en-US'),
    ];
    expect(pickVoice(list)?.name).toBe('Samantha');
    expect(pickVoice(list.filter((v) => v.name !== 'Samantha'))?.name).toBe('Ava (Enhanced)');
    expect(pickVoice(list.filter((v) => v.name === 'Google US English' || v.name === 'Zoe'))?.name).toBe(
      'Google US English'
    );
  });

  it('otherwise takes an en-US voice (the default one first), then any English voice', () => {
    const a = voice('Zoe', 'en-US');
    const b = voice('Alex', 'en-US', { default: true });
    const c = voice('Daniel', 'en-GB');
    expect(pickVoice([c, a, b])).toBe(b);
    expect(pickVoice([c, a])).toBe(a);
    expect(pickVoice([voice('Amelie', 'fr-FR'), c])).toBe(c);
  });

  it('prefers a voice that runs on the device over a network voice, even a better-named one', () => {
    const network = voice('Google US English', 'en-US', { localService: false });
    const local = voice('Zoe', 'en-US');
    expect(pickVoice([network, local])).toBe(local);
    // Within the device's own voices the usual order still holds.
    const samantha = voice('Samantha', 'en-US');
    expect(pickVoice([network, local, samantha])).toBe(samantha);
    // A local British voice still beats a network American one.
    const british = voice('Daniel', 'en-GB');
    expect(pickVoice([network, british])).toBe(british);
    // With nothing local, the network voice is better than none.
    expect(pickVoice([network])).toBe(network);
  });

  it('accepts an underscore in the language tag (some Android builds)', () => {
    expect(pickVoice([voice('Whatever', 'en_US')])?.name).toBe('Whatever');
  });

  it('is null when there is no English voice, so the browser default is used', () => {
    expect(pickVoice([])).toBeNull();
    expect(pickVoice([voice('Amelie', 'fr-FR'), voice('Hans', 'de-DE')])).toBeNull();
  });
});

describe('splitForSpeech', () => {
  it('keeps a short reply in one piece', () => {
    expect(splitForSpeech('We help local businesses save time.')).toEqual([
      'We help local businesses save time.',
    ]);
  });

  it('splits long replies at sentence ends, in pieces no longer than the limit', () => {
    const text =
      'We build AI helpers for local service businesses. They answer the phone and the website chat. ' +
      'They book callbacks. They never guess at prices. Call us any weekday for a walkthrough.';
    const parts = splitForSpeech(text, 100);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(100);
    expect(parts.join(' ')).toBe(text);
  });

  it('breaks one endless sentence at spaces', () => {
    const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const parts = splitForSpeech(text, 80);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(80);
    expect(parts.join(' ')).toBe(text);
  });

  it('does not split inside prices, abbreviations, domains or version numbers', () => {
    for (const text of [
      'Plans start at $3.50 per lead, billed monthly.',
      'We are open 8 a.m. to 6 p.m. on weekdays.',
      'See thg.com/ai for the demo.',
      'This is Version 2.0',
    ]) {
      const parts = splitForSpeech(text);
      // Reads as the text did: nothing cut, nothing added (the old splitter made "$3. 50").
      expect(parts.join(' '), text).toBe(text);
      expect(parts, text).toHaveLength(1);
    }
  });

  it('still breaks two ordinary sentences apart when they will not fit together', () => {
    expect(splitForSpeech('We help local shops. Call us today.', 25)).toEqual([
      'We help local shops.',
      'Call us today.',
    ]);
    expect(splitForSpeech('Is that clear? Yes! Great...', 14)).toEqual([
      'Is that clear?',
      'Yes! Great...',
    ]);
  });

  it('never leaves a price or a domain across two pieces', () => {
    const text = `${'Word '.repeat(30)}costs $3.50 per lead. Then ${'more '.repeat(30)}at thg.com/ai today.`;
    const parts = splitForSpeech(text, 60);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.join(' ')).toBe(text.replace(/\s+/g, ' ').trim());
    expect(parts.some((p) => p.endsWith('$3.') || p.startsWith('50 '))).toBe(false);
  });

  it('collapses whitespace and returns nothing for blank text', () => {
    expect(splitForSpeech('  hello \n\n there  ')).toEqual(['hello there']);
    expect(splitForSpeech('   ')).toEqual([]);
    expect(splitForSpeech('')).toEqual([]);
  });
});

// ---- Browser speech ----------------------------------------------------------

describe('speak (browser voice)', () => {
  it('cancels anything in progress, then speaks the reply in en-US with the chosen voice', () => {
    voices = [voice('Zoe', 'en-US'), voice('Samantha', 'en-US')];
    speak('Hello there.', 'browser');
    expect(synth.cancel).toHaveBeenCalled();
    expect(synth.cancel.mock.invocationCallOrder[0]).toBeLessThan(synth.speak.mock.invocationCallOrder[0]);
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe('Hello there.');
    expect(spoken[0].lang).toBe('en-US');
    expect(spoken[0].voice?.name).toBe('Samantha');
  });

  it('still speaks when the browser has not loaded its voice list yet', () => {
    speak('Hello there.', 'browser');
    expect(spoken).toHaveLength(1);
    expect(spoken[0].voice).toBeNull();
  });

  it('reports the start once and the end once, across several pieces', () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const long = Array.from({ length: 8 }, (_, i) => `Sentence number ${i} is here for the test.`).join(' ');
    speak(long, 'browser', { onStart, onEnd });
    expect(spoken.length).toBeGreaterThan(1);

    spoken[0].onstart?.();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith('browser');
    spoken[1].onstart?.();
    expect(onStart).toHaveBeenCalledTimes(1);

    for (let i = 0; i < spoken.length - 1; i++) spoken[i].onend?.();
    expect(onEnd).not.toHaveBeenCalled();
    spoken.at(-1)!.onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('keeps hold of its utterances while they play (Chrome drops events from collected ones), then lets go', () => {
    const long = Array.from({ length: 8 }, (_, i) => `Sentence number ${i} is here for the test.`).join(' ');
    speak(long, 'browser');
    expect(heldUtteranceCount()).toBe(spoken.length);
    expect(heldUtteranceCount()).toBeGreaterThan(1);
    for (const u of spoken) u.onend?.();
    expect(heldUtteranceCount()).toBe(0);

    speak('Another.', 'browser');
    expect(heldUtteranceCount()).toBe(1);
    stopSpeaking();
    expect(heldUtteranceCount()).toBe(0);
  });

  it('stopSpeaking() cancels the voice and ends at once, ignoring the late "interrupted" event', () => {
    const onEnd = vi.fn();
    speak('Hello there.', 'browser', { onEnd });
    synth.cancel.mockClear();
    stopSpeaking();
    expect(synth.cancel).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    spoken[0].onerror?.({ error: 'interrupted' });
    spoken[0].onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('a new reply replaces the old one; the old one never reports again', () => {
    const first = { onStart: vi.fn(), onEnd: vi.fn() };
    const second = { onStart: vi.fn(), onEnd: vi.fn() };
    speak('First reply.', 'browser', first);
    const firstUtterance = spoken[0];
    speak('Second reply.', 'browser', second);
    expect(first.onEnd).toHaveBeenCalledTimes(1);

    firstUtterance.onend?.();
    firstUtterance.onstart?.();
    expect(first.onEnd).toHaveBeenCalledTimes(1);
    expect(first.onStart).not.toHaveBeenCalled();
    expect(second.onEnd).not.toHaveBeenCalled();

    spoken[1].onstart?.();
    spoken[1].onend?.();
    expect(second.onStart).toHaveBeenCalledTimes(1);
    expect(second.onEnd).toHaveBeenCalledTimes(1);
  });

  it('a real speech error ends it once', () => {
    const onEnd = vi.fn();
    speak('Hello there.', 'browser', { onEnd });
    spoken[0].onerror?.({ error: 'synthesis-failed' });
    spoken[0].onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('makes no sound for blank text or without speech support, but still reports the end once', () => {
    const blank = vi.fn();
    speak('   ', 'browser', { onEnd: blank });
    expect(synth.speak).not.toHaveBeenCalled();
    expect(blank).toHaveBeenCalledTimes(1);

    vi.stubGlobal('speechSynthesis', undefined);
    const unsupported = vi.fn();
    const onStart = vi.fn();
    expect(() => speak('Hi.', 'browser', { onStart, onEnd: unsupported })).not.toThrow();
    expect(onStart).not.toHaveBeenCalled();
    expect(unsupported).toHaveBeenCalledTimes(1);
  });
});

describe('unlockSpeech', () => {
  it('speaks a silent, empty utterance so later speak() calls are allowed (iOS)', () => {
    unlockSpeech();
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe('');
    expect(spoken[0].volume).toBe(0);
  });

  it('also asks for the voice list, which Chrome only starts loading when asked', () => {
    unlockSpeech();
    expect(synth.getVoices).toHaveBeenCalled();
  });

  it('is harmless without speech support or when the browser throws', () => {
    synth.speak.mockImplementation(() => {
      throw new Error('not allowed');
    });
    expect(() => unlockSpeech()).not.toThrow();
    vi.stubGlobal('speechSynthesis', undefined);
    expect(() => unlockSpeech()).not.toThrow();
  });

  it('with the server voice, primes the shared audio element and leaves the browser voice out of it', () => {
    unlockSpeech('server');
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].play).toHaveBeenCalled();
    expect(synth.speak).not.toHaveBeenCalled();
    expect(synth.getVoices).not.toHaveBeenCalled();
  });
});

// ---- Server voice ------------------------------------------------------------

describe('speak (server voice)', () => {
  const clip = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' });
  const ok = () => ({ kind: 'ok' as const, blob: clip() });
  const notAllowed = () => new DOMException('The request is not allowed', 'NotAllowedError');

  it('plays the fetched audio, reports the start as "server" and the end when it finishes', async () => {
    const fetchAudio = vi.fn(async () => ok());
    const onStart = vi.fn();
    const onEnd = vi.fn();
    speak('Hello there.', 'server', { fetchAudio, onStart, onEnd });
    await flush();

    expect(fetchAudio).toHaveBeenCalledWith('Hello there.');
    expect(synth.speak).not.toHaveBeenCalled();
    const audio = FakeAudio.instances.at(-1)!;
    expect(audio.src).toBe('blob:fake');
    expect(audio.play).toHaveBeenCalled();
    expect(onStart).toHaveBeenCalledWith('server');
    expect(onEnd).not.toHaveBeenCalled();

    audio.onended?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('stopSpeaking() pauses the audio and ends at once', async () => {
    const onEnd = vi.fn();
    speak('Hello there.', 'server', { fetchAudio: async () => ok(), onEnd });
    await flush();
    stopSpeaking();
    expect(FakeAudio.instances.at(-1)!.pause).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('stopSpeaking() before the audio arrives means it never plays', async () => {
    let resolve!: (r: ReturnType<typeof ok>) => void;
    const pending = new Promise<ReturnType<typeof ok>>((r) => {
      resolve = r;
    });
    const onStart = vi.fn();
    speak('Hello there.', 'server', { fetchAudio: () => pending, onStart });
    stopSpeaking();
    resolve(ok());
    await flush();
    expect(onStart).not.toHaveBeenCalled();
    expect(FakeAudio.instances.every((a) => a.play.mock.calls.length === 0)).toBe(true);
  });

  it('sends a long but allowed reply (700 characters) to the server voice', async () => {
    expect(SERVER_MAX_CHARS).toBe(1000);
    const fetchAudio = vi.fn(async () => ok());
    const text = `${'word '.repeat(139)}ends.`; // 700 characters
    expect(text.length).toBe(700);
    speak(text, 'server', { fetchAudio });
    await flush();
    expect(fetchAudio).toHaveBeenCalledTimes(1);
    expect(FakeAudio.instances.at(-1)!.play).toHaveBeenCalled();
  });

  describe('when the server voice cannot deliver, the reply stays text: the browser voice never steps in', () => {
    const textOnly = async (
      fetchAudio: ((text: string) => Promise<never>) | undefined,
      text = 'Hello there.'
    ) => {
      const onStart = vi.fn();
      const onEnd = vi.fn();
      speak(text, 'server', { fetchAudio: fetchAudio as never, onStart, onEnd });
      await flush();
      expect(synth.speak, 'no browser speech').not.toHaveBeenCalled();
      expect(synth.cancel).not.toHaveBeenCalled();
      expect(onStart).not.toHaveBeenCalled();
      expect(onEnd).toHaveBeenCalledTimes(1);
    };

    it('the server has no audio for it, or the request fails', async () => {
      await textOnly((async () => ({ kind: 'unavailable' })) as never);
    });

    it('the fetch throws', async () => {
      await textOnly(async () => {
        throw new Error('network');
      });
    });

    it('the reply is over the server limit (it is not sent, and not spoken another way)', async () => {
      const fetchAudio = vi.fn();
      await textOnly(fetchAudio as never, 'x'.repeat(SERVER_MAX_CHARS + 1));
      expect(fetchAudio).not.toHaveBeenCalled();
    });

    it('there is no way to fetch audio at all', async () => {
      await textOnly(undefined);
    });

    it('the audio fails to decode: the URL is freed and that is the end of it', async () => {
      const onEnd = vi.fn();
      speak('Hello there.', 'server', { fetchAudio: async () => ok(), onEnd });
      await flush();
      FakeAudio.instances.at(-1)!.onerror?.();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
      expect(synth.speak).not.toHaveBeenCalled();
      expect(onEnd).toHaveBeenCalledTimes(1);
    });

    it('the browser refuses to play it for a reason other than needing a tap', async () => {
      FakeAudio.playImpl = async () => {
        throw new DOMException('cannot decode', 'NotSupportedError');
      };
      const onBlocked = vi.fn();
      const onEnd = vi.fn();
      speak('Hello there.', 'server', { fetchAudio: async () => ok(), onBlocked, onEnd });
      await flush();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
      expect(onBlocked).not.toHaveBeenCalled();
      expect(synth.speak).not.toHaveBeenCalled();
      expect(onEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe('the daily cap', () => {
    it('reports it, with the bonus flag, and ends: no sound and no browser voice', async () => {
      for (const bonusAvailable of [true, false]) {
        const onLimit = vi.fn();
        const onStart = vi.fn();
        const onEnd = vi.fn();
        speak('Hello there.', 'server', {
          fetchAudio: async () => ({ kind: 'limit', bonusAvailable }),
          onLimit,
          onStart,
          onEnd,
        });
        await flush();
        expect(onLimit).toHaveBeenCalledWith(bonusAvailable);
        expect(onStart).not.toHaveBeenCalled();
        expect(onEnd).toHaveBeenCalledTimes(1);
      }
      expect(synth.speak).not.toHaveBeenCalled();
      expect(FakeAudio.instances.every((a) => a.play.mock.calls.length === 0)).toBe(true);
    });

    it('does not report it for a reply that was stopped meanwhile', async () => {
      let resolve!: (r: { kind: 'limit'; bonusAvailable: boolean }) => void;
      const pending = new Promise<{ kind: 'limit'; bonusAvailable: boolean }>((r) => {
        resolve = r;
      });
      const onLimit = vi.fn();
      speak('Hello there.', 'server', { fetchAudio: () => pending, onLimit });
      stopSpeaking();
      resolve({ kind: 'limit', bonusAvailable: true });
      await flush();
      expect(onLimit).not.toHaveBeenCalled();
    });
  });

  describe('when the browser blocks playback until the visitor taps', () => {
    it('hands the audio over instead of failing quietly, frees the URL, and ends', async () => {
      FakeAudio.playImpl = async () => {
        throw notAllowed();
      };
      const blob = clip();
      const onBlocked = vi.fn();
      const onStart = vi.fn();
      const onEnd = vi.fn();
      speak('Hello there.', 'server', {
        fetchAudio: async () => ({ kind: 'ok', blob }),
        onBlocked,
        onStart,
        onEnd,
      });
      await flush();
      expect(onBlocked).toHaveBeenCalledWith(blob);
      expect(onStart).not.toHaveBeenCalled();
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
      expect(synth.speak).not.toHaveBeenCalled();
    });

    it('without anyone to hand it to, it is just text', async () => {
      FakeAudio.playImpl = async () => {
        throw notAllowed();
      };
      const onEnd = vi.fn();
      speak('Hello there.', 'server', { fetchAudio: async () => ok(), onEnd });
      await flush();
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(synth.speak).not.toHaveBeenCalled();
    });

    it('a stopped reply does not report a block', async () => {
      FakeAudio.playImpl = () =>
        new Promise((_resolve, reject) => setTimeout(() => reject(notAllowed()), 0));
      const onBlocked = vi.fn();
      speak('Hello there.', 'server', { fetchAudio: async () => ok(), onBlocked });
      await new Promise((r) => setTimeout(r, 0));
      stopSpeaking();
      await flush();
      expect(onBlocked).not.toHaveBeenCalled();
    });
  });
});

describe('speakBlob (playing audio we already have, from inside a tap)', () => {
  const clip = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' });

  it('calls play() before it returns, so the tap still counts as the gesture', () => {
    const onStart = vi.fn();
    speakBlob(clip(), { onStart });
    const audio = FakeAudio.instances.at(-1)!;
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.src).toBe('blob:fake');
  });

  it('reports the start as "server" once playing, and the end when it finishes', async () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    speakBlob(clip(), { onStart, onEnd });
    await flush();
    expect(onStart).toHaveBeenCalledWith('server');
    FakeAudio.instances.at(-1)!.onended?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('reports a block again if even the tap is refused', async () => {
    FakeAudio.playImpl = async () => {
      throw new DOMException('no', 'NotAllowedError');
    };
    const blob = clip();
    const onBlocked = vi.fn();
    speakBlob(blob, { onBlocked });
    await flush();
    expect(onBlocked).toHaveBeenCalledWith(blob);
  });

  it('replaces anything being read', async () => {
    const first = { onEnd: vi.fn() };
    speak('First.', 'browser', first);
    speakBlob(clip(), {});
    expect(first.onEnd).toHaveBeenCalledTimes(1);
    expect(synth.cancel).toHaveBeenCalled();
  });

  it('plays on the one shared audio element, so what the tap unlocked stays unlocked for later replies', async () => {
    speakBlob(clip(), {});
    await flush();
    const element = FakeAudio.instances[0];
    expect(FakeAudio.instances).toHaveLength(1);
    element.onended?.();

    speak('Next reply.', 'server', { fetchAudio: async () => ({ kind: 'ok', blob: clip() }) });
    await flush();
    expect(FakeAudio.instances).toHaveLength(1); // no second element for iOS to lock out
    expect(element.play.mock.calls.length).toBe(2);
  });
});
