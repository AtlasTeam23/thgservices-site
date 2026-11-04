import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as speech from '../voice/speech';
import { resetSpeech, SERVER_MAX_CHARS, speak, speakBlob, stopSpeaking, unlockSpeech } from '../voice/speech';

// There is no browser voice: speechSynthesis is stubbed in every test as a trap, and the suite
// fails if anything at all touches it.
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
  synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: vi.fn(() => []) };
  FakeAudio.instances = [];
  FakeAudio.playImpl = async () => {};
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', class {});
  vi.stubGlobal('Audio', FakeAudio);
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  resetSpeech();
  expect(synth.speak, 'the browser voice must never speak').not.toHaveBeenCalled();
  expect(synth.cancel, 'nor be cancelled').not.toHaveBeenCalled();
  expect(synth.getVoices, 'nor asked for its voices').not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('the module', () => {
  it('has no browser voice in it: nothing to pick a voice, split text for it, or ask whether it is supported', () => {
    for (const name of ['isSpeechSupported', 'pickVoice', 'splitForSpeech', 'heldUtteranceCount']) {
      expect(name in speech, name).toBe(false);
    }
  });
});

describe('unlockSpeech', () => {
  it('primes the one shared audio element inside the gesture, with a silent clip', () => {
    unlockSpeech();
    expect(FakeAudio.instances).toHaveLength(1);
    const audio = FakeAudio.instances[0];
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.src.startsWith('data:audio/wav')).toBe(true);
  });

  it('does not await anything: play() is reached before it returns', () => {
    let reached = false;
    FakeAudio.playImpl = () => {
      reached = true;
      return new Promise(() => {});
    };
    unlockSpeech();
    expect(reached).toBe(true);
  });

  it('is harmless without Audio, or when the browser refuses', async () => {
    FakeAudio.playImpl = async () => {
      throw new DOMException('no', 'NotAllowedError');
    };
    expect(() => unlockSpeech()).not.toThrow();
    await flush();
    vi.stubGlobal('Audio', undefined);
    expect(() => unlockSpeech()).not.toThrow();
  });

  it('reuses the same element every time', () => {
    unlockSpeech();
    unlockSpeech();
    expect(FakeAudio.instances).toHaveLength(1);
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
    speak('Hello there.', { fetchAudio, onStart, onEnd });
    await flush();

    expect(fetchAudio).toHaveBeenCalledWith('Hello there.', expect.any(AbortSignal));
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
    speak('Hello there.', { fetchAudio: async () => ok(), onEnd });
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
    speak('Hello there.', { fetchAudio: () => pending, onStart });
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
    speak(text, { fetchAudio });
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
      speak(text, { fetchAudio: fetchAudio as never, onStart, onEnd });
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
      speak('Hello there.', { fetchAudio: async () => ok(), onEnd });
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
      speak('Hello there.', { fetchAudio: async () => ok(), onBlocked, onEnd });
      await flush();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
      expect(onBlocked).not.toHaveBeenCalled();
      expect(synth.speak).not.toHaveBeenCalled();
      expect(onEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe('the request is cancelled when the reply is no longer wanted', () => {
    const pendingFetch = () => {
      const signals: AbortSignal[] = [];
      const fetchAudio = vi.fn(
        (_text: string, signal?: AbortSignal) =>
          new Promise<ReturnType<typeof ok>>(() => {
            if (signal) signals.push(signal);
          })
      );
      return { fetchAudio, signals };
    };

    it('gives fetchAudio a signal', () => {
      const { fetchAudio, signals } = pendingFetch();
      speak('Hello there.', { fetchAudio });
      expect(fetchAudio).toHaveBeenCalledWith('Hello there.', expect.any(AbortSignal));
      expect(signals[0].aborted).toBe(false);
    });

    it('stopSpeaking() aborts it (a closed panel, an unmounted one, any new input)', () => {
      const { fetchAudio, signals } = pendingFetch();
      speak('Hello there.', { fetchAudio });
      stopSpeaking();
      expect(signals[0].aborted).toBe(true);
    });

    it('a replacing reply aborts the request of the one it replaces, and only that one', () => {
      const { fetchAudio, signals } = pendingFetch();
      speak('First.', { fetchAudio });
      speak('Second.', { fetchAudio });
      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(false);
    });

    it('speakBlob (a tap on a waiting reply) aborts a request that is out', () => {
      const { fetchAudio, signals } = pendingFetch();
      speak('First.', { fetchAudio });
      speakBlob(clip(), {});
      expect(signals[0].aborted).toBe(true);
    });

    it('an aborted request that comes back anyway plays nothing', async () => {
      let resolve!: (r: ReturnType<typeof ok>) => void;
      const onStart = vi.fn();
      speak('Hello there.', {
        fetchAudio: () =>
          new Promise((r) => {
            resolve = r;
          }),
        onStart,
      });
      stopSpeaking();
      resolve(ok());
      await flush();
      expect(onStart).not.toHaveBeenCalled();
    });
  });

  describe('a reply fetched for a panel nobody is looking at', () => {
    it('is dropped when canPlay says no once the audio has arrived: nothing is created, played or reported as started', async () => {
      let canPlay = true;
      let resolve!: (r: ReturnType<typeof ok>) => void;
      const pending = new Promise<ReturnType<typeof ok>>((r) => {
        resolve = r;
      });
      const onStart = vi.fn();
      const onEnd = vi.fn();
      speak('Hello there.', { fetchAudio: () => pending, canPlay: () => canPlay, onStart, onEnd });
      canPlay = false; // the tab was hidden (or the panel closed) while the request was out
      resolve(ok());
      await flush();
      expect(FakeAudio.instances.every((a) => a.play.mock.calls.length === 0)).toBe(true);
      expect(onStart).not.toHaveBeenCalled();
      expect(onEnd).toHaveBeenCalledTimes(1);
    });

    it('plays as usual when canPlay still says yes', async () => {
      const onStart = vi.fn();
      speak('Hello there.', { fetchAudio: async () => ok(), canPlay: () => true, onStart });
      await flush();
      expect(onStart).toHaveBeenCalledWith('server');
    });

    it('is not handed over as a "tap to hear" either: a hidden tab has nobody to tap', async () => {
      FakeAudio.playImpl = async () => {
        throw notAllowed();
      };
      const onBlocked = vi.fn();
      speak('Hello there.', { fetchAudio: async () => ok(), canPlay: () => false, onBlocked });
      await flush();
      expect(onBlocked).not.toHaveBeenCalled();
    });
  });

  describe('the daily cap', () => {
    it('reports it, with the bonus flag, and ends: no sound and no browser voice', async () => {
      for (const bonusAvailable of [true, false]) {
        const onLimit = vi.fn();
        const onStart = vi.fn();
        const onEnd = vi.fn();
        speak('Hello there.', {
          fetchAudio: async () => ({ kind: 'limit', bonusAvailable }),
          onLimit,
          onStart,
          onEnd,
        });
        await flush();
        expect(onLimit).toHaveBeenCalledWith(bonusAvailable, undefined);
        expect(onStart).not.toHaveBeenCalled();
        expect(onEnd).toHaveBeenCalledTimes(1);
      }
      expect(synth.speak).not.toHaveBeenCalled();
      expect(FakeAudio.instances.every((a) => a.play.mock.calls.length === 0)).toBe(true);
    });

    it('passes on how many replies the bonus adds, when the Worker said', async () => {
      const onLimit = vi.fn();
      speak('Hello there.', {
        fetchAudio: async () => ({ kind: 'limit', bonusAvailable: true, bonus: 10 }),
        onLimit,
      });
      await flush();
      expect(onLimit).toHaveBeenCalledWith(true, 10);
    });

    it('does not report it for a reply that was stopped meanwhile', async () => {
      let resolve!: (r: { kind: 'limit'; bonusAvailable: boolean }) => void;
      const pending = new Promise<{ kind: 'limit'; bonusAvailable: boolean }>((r) => {
        resolve = r;
      });
      const onLimit = vi.fn();
      speak('Hello there.', { fetchAudio: () => pending, onLimit });
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
      speak('Hello there.', {
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
      speak('Hello there.', { fetchAudio: async () => ok(), onEnd });
      await flush();
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(synth.speak).not.toHaveBeenCalled();
    });

    it('a stopped reply does not report a block', async () => {
      FakeAudio.playImpl = () =>
        new Promise((_resolve, reject) => setTimeout(() => reject(notAllowed()), 0));
      const onBlocked = vi.fn();
      speak('Hello there.', { fetchAudio: async () => ok(), onBlocked });
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
    const first = { onEnd: vi.fn(), fetchAudio: async () => ({ kind: 'ok' as const, blob: clip() }) };
    speak('First.', first);
    await flush();
    speakBlob(clip(), {});
    expect(first.onEnd).toHaveBeenCalledTimes(1);
  });

  it('plays on the one shared audio element, so what the tap unlocked stays unlocked for later replies', async () => {
    speakBlob(clip(), {});
    await flush();
    const element = FakeAudio.instances[0];
    expect(FakeAudio.instances).toHaveLength(1);
    element.onended?.();

    speak('Next reply.', { fetchAudio: async () => ({ kind: 'ok', blob: clip() }) });
    await flush();
    expect(FakeAudio.instances).toHaveLength(1); // no second element for iOS to lock out
    expect(element.play.mock.calls.length).toBe(2);
  });
});
