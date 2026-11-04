import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENDING_WARNING_MS,
  STOP_WATCHDOG_MS,
  isRecordingSupported,
  MAX_RECORDING_MS,
  pickMimeType,
  startRecording,
  VoiceError,
} from '../voice/recorder';

// ---- Fakes -------------------------------------------------------------------

type Handler<E> = ((e: E) => void) | null;

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static supported = new Set<string>(['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']);
  static isTypeSupported = (t: string) => FakeRecorder.supported.has(t);
  /** Bytes the next stop() delivers. */
  static nextBytes = 4;
  /** Make start() throw (Safari does, for example, with InvalidStateError). */
  static startError: Error | null = null;
  /** stop() succeeds but the browser never fires `stop`. */
  static silentStop = false;

  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: Handler<{ data: Blob }> = null;
  onstop: Handler<Event> = null;
  onerror: Handler<Event> = null;
  start = vi.fn(() => {
    if (FakeRecorder.startError) throw FakeRecorder.startError;
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    if (FakeRecorder.silentStop) return;
    if (FakeRecorder.nextBytes > 0) {
      this.ondataavailable?.({
        data: new Blob([new Uint8Array(FakeRecorder.nextBytes)], { type: this.mimeType }),
      });
    }
    this.onstop?.(new Event('stop'));
  });

  stream: MediaStream;

  options?: { mimeType?: string; audioBitsPerSecond?: number };

  constructor(stream: MediaStream, options?: { mimeType?: string; audioBitsPerSecond?: number }) {
    this.stream = stream;
    this.options = options;
    this.mimeType = options?.mimeType ?? '';
    FakeRecorder.instances.push(this);
  }
}

class FakeTrack {
  stop = vi.fn();
}
const makeStream = () => {
  const tracks = [new FakeTrack(), new FakeTrack()];
  return { stream: { getTracks: () => tracks } as unknown as MediaStream, tracks };
};

class FakeAnalyser {
  fftSize = 0;
  smoothingTimeConstant = 0;
  /** Distance from the 128 midpoint that every sample is filled with. */
  static swing = 0;
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  getByteTimeDomainData(arr: Uint8Array) {
    arr.fill(128 + FakeAnalyser.swing);
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state = 'running';
  source = { connect: vi.fn(), disconnect: vi.fn() };
  analyser = new FakeAnalyser();
  createMediaStreamSource = vi.fn(() => this.source);
  createAnalyser = vi.fn(() => this.analyser);
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

const setMediaDevices = (getUserMedia: unknown) => {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: getUserMedia ? { getUserMedia } : undefined,
    configurable: true,
  });
};

const domError = (name: string) => Object.assign(new Error(name), { name });

let stream: ReturnType<typeof makeStream>;
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeRecorder.instances = [];
  FakeRecorder.nextBytes = 4;
  FakeRecorder.startError = null;
  FakeRecorder.silentStop = false;
  FakeRecorder.supported = new Set(['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']);
  FakeAudioContext.instances = [];
  FakeAnalyser.swing = 0;
  stream = makeStream();
  getUserMedia = vi.fn(async () => stream.stream);
  setMediaDevices(getUserMedia);
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setMediaDevices(null);
});

// ---- Detection ---------------------------------------------------------------

describe('isRecordingSupported / pickMimeType', () => {
  it('is true with MediaRecorder, getUserMedia and a supported type', () => {
    expect(isRecordingSupported()).toBe(true);
  });

  it('is false without MediaRecorder', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    expect(isRecordingSupported()).toBe(false);
    expect(pickMimeType()).toBeNull();
  });

  it('is false without getUserMedia', () => {
    setMediaDevices(null);
    expect(isRecordingSupported()).toBe(false);
  });

  it('is false when none of the allowed types can be recorded', () => {
    FakeRecorder.supported = new Set(['audio/aac']);
    expect(pickMimeType()).toBeNull();
    expect(isRecordingSupported()).toBe(false);
  });

  it('is false when isTypeSupported is missing (a very old engine)', () => {
    vi.stubGlobal('MediaRecorder', class {});
    expect(isRecordingSupported()).toBe(false);
  });

  it('prefers webm/opus, then mp4, then ogg/opus', () => {
    expect(pickMimeType()).toBe('audio/webm;codecs=opus');
    FakeRecorder.supported.delete('audio/webm;codecs=opus');
    expect(pickMimeType()).toBe('audio/mp4'); // Safari
    FakeRecorder.supported.delete('audio/mp4');
    expect(pickMimeType()).toBe('audio/ogg;codecs=opus');
  });
});

// ---- Recording ---------------------------------------------------------------

describe('startRecording', () => {
  it('asks for the microphone, starts a MediaRecorder with the chosen type, and keeps a stream open', async () => {
    const rec = await startRecording();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(FakeRecorder.instances).toHaveLength(1);
    expect(FakeRecorder.instances[0].mimeType).toBe('audio/webm;codecs=opus');
    // Speech bitrate, not the browser's music-grade default, so the upload stays small.
    expect(FakeRecorder.instances[0].options?.audioBitsPerSecond).toBe(32_000);
    expect(FakeRecorder.instances[0].start).toHaveBeenCalledTimes(1);
    expect(stream.tracks[0].stop).not.toHaveBeenCalled();
    rec.cancel();
  });

  it('resolves with the recorded blob, its type and the measured duration on stop()', async () => {
    const rec = await startRecording();
    await vi.advanceTimersByTimeAsync(2500);
    rec.stop();
    const result = await rec.result;
    expect(result).not.toBeNull();
    expect(result!.blob.size).toBe(4);
    expect(result!.mime).toBe('audio/webm;codecs=opus');
    expect(result!.durationMs).toBe(2500);
  });

  it('releases every microphone track when it stops', async () => {
    const rec = await startRecording();
    rec.stop();
    await rec.result;
    for (const t of stream.tracks) expect(t.stop).toHaveBeenCalledTimes(1);
  });

  it('stop() twice is harmless', async () => {
    const rec = await startRecording();
    rec.stop();
    rec.stop();
    await rec.result;
    expect(FakeRecorder.instances[0].stop).toHaveBeenCalledTimes(1);
  });

  it('resolves null when nothing was recorded', async () => {
    FakeRecorder.nextBytes = 0;
    const rec = await startRecording();
    rec.stop();
    expect(await rec.result).toBeNull();
    for (const t of stream.tracks) expect(t.stop).toHaveBeenCalled();
  });

  it('stops by itself at 20 seconds, warning 5 seconds before', async () => {
    expect(MAX_RECORDING_MS).toBe(20_000);
    expect(ENDING_WARNING_MS).toBe(5_000);
    const onEnding = vi.fn();
    const rec = await startRecording({ onEnding });

    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS - ENDING_WARNING_MS - 1);
    expect(onEnding).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onEnding).toHaveBeenCalledTimes(1);
    expect(FakeRecorder.instances[0].stop).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(ENDING_WARNING_MS);
    expect(FakeRecorder.instances[0].stop).toHaveBeenCalledTimes(1);
    const result = await rec.result;
    expect(result!.durationMs).toBe(MAX_RECORDING_MS);
    for (const t of stream.tracks) expect(t.stop).toHaveBeenCalled();
  });

  it('does not fire the timers after a manual stop', async () => {
    const onEnding = vi.fn();
    const rec = await startRecording({ onEnding });
    rec.stop();
    await rec.result;
    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS * 2);
    expect(onEnding).not.toHaveBeenCalled();
    expect(FakeRecorder.instances[0].stop).toHaveBeenCalledTimes(1);
  });

  it('cancel() discards the audio, resolves null and releases the microphone', async () => {
    const rec = await startRecording();
    rec.cancel();
    expect(await rec.result).toBeNull();
    for (const t of stream.tracks) expect(t.stop).toHaveBeenCalledTimes(1);
    // A late stop after cancel changes nothing.
    rec.stop();
  });

  it('resolves null and releases the microphone if the recorder errors', async () => {
    const rec = await startRecording();
    FakeRecorder.instances[0].onerror?.(new Event('error'));
    expect(await rec.result).toBeNull();
    for (const t of stream.tracks) expect(t.stop).toHaveBeenCalled();
  });

  it('cancel() leaves no timer behind: no warning, no cap, no more level readings', async () => {
    const onEnding = vi.fn();
    const onLevel = vi.fn();
    const rec = await startRecording({ onEnding, onLevel });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    rec.cancel();
    await rec.result;
    expect(vi.getTimerCount()).toBe(0);
    const calls = onLevel.mock.calls.length;
    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS * 2);
    expect(onEnding).not.toHaveBeenCalled();
    expect(onLevel).toHaveBeenCalledTimes(calls);
  });

  it('a recorder error leaves no timer behind and closes the AudioContext', async () => {
    const onEnding = vi.fn();
    const onLevel = vi.fn();
    const rec = await startRecording({ onEnding, onLevel });
    FakeRecorder.instances[0].onerror?.(new Event('error'));
    expect(await rec.result).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS * 2);
    expect(onEnding).not.toHaveBeenCalled();
  });

  it('gives up waiting for the browser to confirm a stop after 2 seconds', async () => {
    expect(STOP_WATCHDOG_MS).toBe(2_000);
    FakeRecorder.silentStop = true;
    const onLevel = vi.fn();
    const rec = await startRecording({ onLevel });
    rec.stop();
    let settled = false;
    void rec.result.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(STOP_WATCHDOG_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await rec.result).toBeNull();
    for (const t of stream.tracks) expect(t.stop).toHaveBeenCalled();
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the stop watchdog stays quiet when the browser does confirm the stop', async () => {
    const rec = await startRecording();
    rec.stop();
    expect((await rec.result)!.blob.size).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop() on a recorder that has already gone inactive finishes at once', async () => {
    const rec = await startRecording();
    FakeRecorder.instances[0].state = 'inactive';
    rec.stop();
    expect(await rec.result).toBeNull();
  });
});

// ---- Failures ----------------------------------------------------------------

describe('startRecording failures', () => {
  const reasonOf = async (): Promise<string> => {
    try {
      await startRecording();
    } catch (e) {
      expect(e).toBeInstanceOf(VoiceError);
      return (e as VoiceError).reason;
    }
    throw new Error('expected startRecording to reject');
  };

  it('a refused permission prompt is "permission"', async () => {
    getUserMedia.mockRejectedValue(domError('NotAllowedError'));
    expect(await reasonOf()).toBe('permission');
    getUserMedia.mockRejectedValue(domError('SecurityError'));
    expect(await reasonOf()).toBe('permission');
  });

  it('no microphone at all is "unsupported"', async () => {
    getUserMedia.mockRejectedValue(domError('NotFoundError'));
    expect(await reasonOf()).toBe('unsupported');
  });

  it('a busy or broken microphone is "device" (worth retrying)', async () => {
    getUserMedia.mockRejectedValue(domError('NotReadableError'));
    expect(await reasonOf()).toBe('device');
    getUserMedia.mockRejectedValue(domError('AbortError'));
    expect(await reasonOf()).toBe('device');
  });

  it('missing browser support is "unsupported"', async () => {
    setMediaDevices(null);
    expect(await reasonOf()).toBe('unsupported');
    setMediaDevices(getUserMedia);
    vi.stubGlobal('MediaRecorder', undefined);
    expect(await reasonOf()).toBe('unsupported');
  });

  it('a recorder whose start() throws (Safari) releases everything it opened and reports "device"', async () => {
    FakeRecorder.startError = Object.assign(new Error('InvalidStateError'), { name: 'InvalidStateError' });
    const onLevel = vi.fn();
    let caught: unknown;
    try {
      await startRecording({ onLevel });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(VoiceError);
    expect((caught as VoiceError).reason).toBe('device');
    for (const t of stream.tracks) expect(t.stop).toHaveBeenCalledTimes(1);
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalled();
    expect(FakeAudioContext.instances[0].source.disconnect).toHaveBeenCalled();
    // The level meter's interval is gone: nothing is left running.
    expect(vi.getTimerCount()).toBe(0);
    const calls = onLevel.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(onLevel).toHaveBeenCalledTimes(calls);
  });

  it('closes the AudioContext it opened when the microphone is refused', async () => {
    getUserMedia.mockRejectedValue(domError('NotAllowedError'));
    await expect(startRecording({ onLevel: vi.fn() })).rejects.toBeInstanceOf(VoiceError);
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalled();
  });

  it('a MediaRecorder that cannot be built releases the microphone it just got', async () => {
    vi.stubGlobal(
      'MediaRecorder',
      Object.assign(
        class {
          constructor() {
            throw new Error('nope');
          }
        },
        { isTypeSupported: () => true }
      )
    );
    expect(await reasonOf()).toBe('unsupported');
    for (const t of stream.tracks) expect(t.stop).toHaveBeenCalled();
  });
});

// ---- Level meter -------------------------------------------------------------

describe('level meter', () => {
  it('opens the AudioContext before waiting for the microphone, so iOS counts it as part of the tap', async () => {
    const order: string[] = [];
    const Original = FakeAudioContext;
    vi.stubGlobal(
      'AudioContext',
      class extends Original {
        constructor() {
          super();
          order.push('context');
        }
      }
    );
    getUserMedia.mockImplementation(async () => {
      order.push('getUserMedia');
      return stream.stream;
    });
    const rec = await startRecording({ onLevel: vi.fn() });
    expect(order).toEqual(['context', 'getUserMedia']);
    rec.cancel();
  });

  it('reports a 0..1 level that follows the signal, about 20 times a second', async () => {
    const onLevel = vi.fn();
    const rec = await startRecording({ onLevel });
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.source.connect).toHaveBeenCalledWith(ctx.analyser);

    FakeAnalyser.swing = 0;
    await vi.advanceTimersByTimeAsync(100);
    expect(onLevel.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(onLevel.mock.calls.at(-1)![0]).toBe(0);

    FakeAnalyser.swing = 8;
    await vi.advanceTimersByTimeAsync(50);
    const quiet = onLevel.mock.calls.at(-1)![0] as number;
    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(1);

    FakeAnalyser.swing = 100;
    await vi.advanceTimersByTimeAsync(50);
    const loud = onLevel.mock.calls.at(-1)![0] as number;
    expect(loud).toBe(1);
    expect(loud).toBeGreaterThan(quiet);
    rec.cancel();
  });

  it('stops sampling, drops the level to zero and closes the AudioContext when recording ends', async () => {
    const onLevel = vi.fn();
    const rec = await startRecording({ onLevel });
    rec.stop();
    await rec.result;
    expect(onLevel).toHaveBeenLastCalledWith(0);
    const calls = onLevel.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(onLevel).toHaveBeenCalledTimes(calls);
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalled();
    expect(FakeAudioContext.instances[0].source.disconnect).toHaveBeenCalled();
  });

  it('wakes a suspended AudioContext, and leaves a running one alone', async () => {
    const running = await startRecording({ onLevel: vi.fn() });
    expect(FakeAudioContext.instances[0].state).toBe('running');
    expect(FakeAudioContext.instances[0].resume).not.toHaveBeenCalled();
    running.cancel();

    class Suspended extends FakeAudioContext {
      state = 'suspended';
    }
    vi.stubGlobal('AudioContext', Suspended);
    const suspended = await startRecording({ onLevel: vi.fn() });
    const ctx = FakeAudioContext.instances.at(-1)!;
    expect(ctx).not.toBe(FakeAudioContext.instances[0]);
    expect(ctx.state).toBe('suspended');
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    suspended.cancel();
  });

  it('still records when there is no AudioContext, or it throws', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const onLevel = vi.fn();
    const rec = await startRecording({ onLevel });
    rec.stop();
    expect((await rec.result)!.blob.size).toBe(4);
    expect(onLevel).not.toHaveBeenCalled();

    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('blocked');
        }
      }
    );
    const rec2 = await startRecording({ onLevel });
    rec2.stop();
    expect((await rec2.result)!.blob.size).toBe(4);
  });

  it('does not create an AudioContext when nobody listens to the level', async () => {
    const rec = await startRecording();
    expect(FakeAudioContext.instances).toHaveLength(0);
    rec.cancel();
  });
});
