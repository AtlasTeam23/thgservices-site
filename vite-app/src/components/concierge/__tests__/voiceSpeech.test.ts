import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AURA_MAX_CHARS,
  heldUtteranceCount,
  isSpeechSupported,
  pickVoice,
  resetSpeech,
  speak,
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

  it('also plays a silent clip on the shared audio element when the premium voice is on', () => {
    unlockSpeech('aura');
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].play).toHaveBeenCalled();
  });
});

// ---- Premium voice -----------------------------------------------------------

describe('speak (aura voice)', () => {
  const clip = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' });

  it('plays the fetched audio, reports the start as "aura" and the end when it finishes', async () => {
    const fetchAudio = vi.fn(async () => clip());
    const onStart = vi.fn();
    const onEnd = vi.fn();
    speak('Hello there.', 'aura', { fetchAudio, onStart, onEnd });
    await flush();

    expect(fetchAudio).toHaveBeenCalledWith('Hello there.');
    expect(synth.speak).not.toHaveBeenCalled();
    const audio = FakeAudio.instances.at(-1)!;
    expect(audio.src).toBe('blob:fake');
    expect(audio.play).toHaveBeenCalled();
    expect(onStart).toHaveBeenCalledWith('aura');
    expect(onEnd).not.toHaveBeenCalled();

    audio.onended?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('stopSpeaking() pauses the audio and ends at once', async () => {
    const onEnd = vi.fn();
    speak('Hello there.', 'aura', { fetchAudio: async () => clip(), onEnd });
    await flush();
    stopSpeaking();
    expect(FakeAudio.instances.at(-1)!.pause).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('stopSpeaking() before the audio arrives means it never plays', async () => {
    let resolve!: (b: Blob) => void;
    const pending = new Promise<Blob>((r) => {
      resolve = r;
    });
    const onStart = vi.fn();
    speak('Hello there.', 'aura', { fetchAudio: () => pending, onStart });
    stopSpeaking();
    resolve(clip());
    await flush();
    expect(onStart).not.toHaveBeenCalled();
    expect(FakeAudio.instances.every((a) => a.play.mock.calls.length === 0)).toBe(true);
  });

  it('falls back to the browser voice when the premium voice is unavailable', async () => {
    const onStart = vi.fn();
    speak('Hello there.', 'aura', { fetchAudio: async () => null, onStart });
    await flush();
    expect(spoken.map((u) => u.text)).toEqual(['Hello there.']);
    spoken[0].onstart?.();
    expect(onStart).toHaveBeenCalledWith('browser');
  });

  it('falls back when the fetch throws or the browser refuses to play the audio', async () => {
    speak('Hello there.', 'aura', {
      fetchAudio: async () => {
        throw new Error('network');
      },
    });
    await flush();
    expect(spoken).toHaveLength(1);

    spoken.length = 0;
    FakeAudio.playImpl = async () => {
      throw new DOMException('blocked', 'NotAllowedError');
    };
    speak('Second reply.', 'aura', { fetchAudio: async () => clip() });
    await flush();
    expect(spoken.map((u) => u.text)).toEqual(['Second reply.']);
  });

  it('sends a long but allowed reply (700 characters) to the premium voice', async () => {
    expect(AURA_MAX_CHARS).toBe(1000);
    const fetchAudio = vi.fn(async () => clip());
    const text = `${'word '.repeat(139)}ends.`; // 700 characters
    expect(text.length).toBe(700);
    speak(text, 'aura', { fetchAudio });
    await flush();
    expect(fetchAudio).toHaveBeenCalledTimes(1);
    expect(FakeAudio.instances.at(-1)!.play).toHaveBeenCalled();
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('frees the audio URL when the audio fails to decode, then reads the reply with the browser voice', async () => {
    const onStart = vi.fn();
    speak('Hello there.', 'aura', { fetchAudio: async () => clip(), onStart });
    await flush();
    const audio = FakeAudio.instances.at(-1)!;
    audio.onerror?.();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    expect(spoken.map((u) => u.text)).toEqual(['Hello there.']);
  });

  it('frees the audio URL when the browser refuses to play it', async () => {
    FakeAudio.playImpl = async () => {
      throw new DOMException('blocked', 'NotAllowedError');
    };
    speak('Hello there.', 'aura', { fetchAudio: async () => clip() });
    await flush();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    expect(spoken).toHaveLength(1);
  });

  it('uses the browser voice for a reply over the server limit, without calling the server', async () => {
    const fetchAudio = vi.fn(async () => clip());
    const text = 'x'.repeat(AURA_MAX_CHARS + 1);
    speak(text, 'aura', { fetchAudio });
    await flush();
    expect(fetchAudio).not.toHaveBeenCalled();
    expect(spoken.length).toBeGreaterThan(0);
  });

  it('uses the browser voice when no fetcher is given', async () => {
    speak('Hello there.', 'aura');
    await flush();
    expect(spoken).toHaveLength(1);
  });
});
