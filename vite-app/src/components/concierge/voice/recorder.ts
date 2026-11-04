// Microphone capture for push-to-talk (voice plan section 1.4): feature
// detection, MIME choice, a MediaRecorder with a 20 second hard stop, and a live
// level for the equalizer. Nothing here touches the network or React.
//
// Every path out of a recording (stop, the 20 s cap, cancel, an error) releases
// the microphone tracks and the AudioContext, so the browser's recording
// indicator goes out the moment the visitor is done.

/** The longest utterance the Worker accepts. */
export const MAX_RECORDING_MS = 20_000;
/** The countdown ring and the "N seconds left" text start this long before the cap. */
export const ENDING_WARNING_MS = 5_000;
/** After stop(), how long to wait for the browser's own `stop` event before giving up on the clip. */
export const STOP_WATCHDOG_MS = 2_000;
/** Shorter than this is a slip of the finger, not speech; it is never sent for transcription. */
export const MIN_RECORDING_MS = 400;

/**
 * Speech needs far less than the browser's default (about 128 kbps in Chrome): 32 kbps keeps a
 * full 20 second clip near 80 KB, well inside the Worker's 1 MB limit and quick to upload.
 */
export const AUDIO_BITS_PER_SECOND = 32_000;

const LEVEL_INTERVAL_MS = 50;
/** Speech sits well under full scale; this makes ordinary talking fill most of the range. */
const LEVEL_GAIN = 4;

/** Best first. Only these are accepted by the Worker (webm, mp4, ogg). */
export const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const;

export type RecordingResult = {
  blob: Blob;
  /** The type the browser actually recorded, for example "audio/webm;codecs=opus". */
  mime: string;
  durationMs: number;
};

/**
 * Why the microphone could not be used:
 *  - permission: the visitor (or the browser) said no
 *  - unsupported: no recording support, or no microphone at all; do not offer the mic again
 *  - device: busy or broken right now; worth another try
 */
export type VoiceErrorReason = 'permission' | 'unsupported' | 'device';

export class VoiceError extends Error {
  reason: VoiceErrorReason;
  constructor(reason: VoiceErrorReason) {
    super(reason);
    this.name = 'VoiceError';
    this.reason = reason;
  }
}

export type RecorderOptions = {
  /** Called about 20 times a second with the input level, 0 to 1. Asking for it opens an AudioContext. */
  onLevel?: (level: number) => void;
  /** Called once, ENDING_WARNING_MS before the 20 second cap. */
  onEnding?: () => void;
};

export type Recording = {
  /** Settles when the recording ends for any reason; null when there is nothing to send. */
  result: Promise<RecordingResult | null>;
  /** Finish and deliver what was recorded. */
  stop: () => void;
  /** Throw the audio away. */
  cancel: () => void;
};

const hasMediaRecorder = () =>
  typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function';

const hasGetUserMedia = () =>
  typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

/** The first of MIME_CANDIDATES this browser can record, or null. */
export function pickMimeType(): string | null {
  if (!hasMediaRecorder()) return null;
  for (const type of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // try the next one
    }
  }
  return null;
}

export const isRecordingSupported = (): boolean => hasGetUserMedia() && pickMimeType() !== null;

function reasonFor(error: unknown): VoiceErrorReason {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'permission';
  }
  // TypeError: getUserMedia exists but the constraints were rejected outright.
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'TypeError') {
    return 'unsupported';
  }
  return 'device';
}

// Every browser that has MediaRecorder has the unprefixed AudioContext too.
function openAudioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  try {
    return new AudioContext();
  } catch {
    return null;
  }
}

const closeContext = (ctx: AudioContext | null) => {
  if (!ctx) return;
  try {
    void ctx.close().catch(() => {});
  } catch {
    // already closed
  }
};

/** RMS of the waveform, scaled so normal speech reaches most of 0 to 1. */
function levelOf(samples: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i] - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * LEVEL_GAIN);
}

/** Feeds `onLevel` from the stream; returns a function that stops it and closes the context. */
function startMeter(
  ctx: AudioContext,
  media: MediaStream,
  onLevel: (level: number) => void
): () => void {
  try {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(media);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      onLevel(levelOf(samples));
    }, LEVEL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      try {
        source.disconnect();
      } catch {
        // already disconnected
      }
      onLevel(0);
      closeContext(ctx);
    };
  } catch {
    // The meter is a nicety; recording goes on without it.
    closeContext(ctx);
    return () => {};
  }
}

const release = (media: MediaStream) => {
  for (const track of media.getTracks()) {
    try {
      track.stop();
    } catch {
      // already stopped
    }
  }
};

/**
 * Ask for the microphone and start recording. Rejects with a VoiceError. Call it
 * straight from the press: the AudioContext is opened before the permission wait
 * so that iOS treats it as part of the tap.
 */
export async function startRecording(options: RecorderOptions = {}): Promise<Recording> {
  const { onLevel, onEnding } = options;
  const mime = pickMimeType();
  if (!hasGetUserMedia() || !mime) throw new VoiceError('unsupported');

  const ctx = onLevel ? openAudioContext() : null;

  let media: MediaStream;
  try {
    media = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    closeContext(ctx);
    throw new VoiceError(reasonFor(error));
  }

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(media, { mimeType: mime, audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
  } catch {
    release(media);
    closeContext(ctx);
    throw new VoiceError('unsupported');
  }

  const chunks: Blob[] = [];
  let startedAt = 0;
  let finished = false;
  let stopping = false;
  let discard = false;
  let resolveResult: (value: RecordingResult | null) => void = () => {};
  const result = new Promise<RecordingResult | null>((resolve) => {
    resolveResult = resolve;
  });
  const stopMeter = ctx && onLevel ? startMeter(ctx, media, onLevel) : () => {};
  const timers: {
    ending?: ReturnType<typeof setTimeout>;
    cap?: ReturnType<typeof setTimeout>;
    watchdog?: ReturnType<typeof setTimeout>;
  } = {};

  const clearTimers = () => {
    clearTimeout(timers.ending);
    clearTimeout(timers.cap);
    clearTimeout(timers.watchdog);
  };

  const finish = (value: RecordingResult | null) => {
    if (finished) return;
    finished = true;
    clearTimers();
    stopMeter();
    release(media);
    resolveResult(value);
  };

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = () => {
    if (discard || chunks.length === 0) {
      finish(null);
      return;
    }
    const type = recorder.mimeType || mime;
    finish({
      blob: new Blob(chunks, { type }),
      mime: type,
      durationMs: Math.max(0, Date.now() - startedAt),
    });
  };
  recorder.onerror = () => {
    discard = true;
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch {
      // the recorder is already broken
    }
    finish(null);
  };

  const stop = () => {
    if (finished || stopping) return;
    stopping = true;
    clearTimers();
    try {
      if (recorder.state !== 'inactive') {
        recorder.stop(); // onstop delivers the result...
        // ...unless the browser never fires it; do not leave the microphone open for that.
        if (!finished) timers.watchdog = setTimeout(() => finish(null), STOP_WATCHDOG_MS);
        return;
      }
    } catch {
      // fall through to finishing without audio
    }
    finish(null);
  };

  const cancel = () => {
    if (finished) return;
    discard = true;
    stopping = true;
    clearTimers();
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch {
      // nothing to stop
    }
    finish(null);
  };

  try {
    recorder.start();
  } catch {
    // Safari can throw here (InvalidStateError, NotSupportedError) with the microphone,
    // the AudioContext and the level meter already live: release all of it.
    finish(null);
    throw new VoiceError('device');
  }
  startedAt = Date.now();
  timers.ending = setTimeout(() => onEnding?.(), MAX_RECORDING_MS - ENDING_WARNING_MS);
  timers.cap = setTimeout(stop, MAX_RECORDING_MS);

  return { result, stop, cancel };
}
