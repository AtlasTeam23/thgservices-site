// Can this browser record speech at all? Kept apart from recorder.ts so the always-loaded bubble can ask
// (before it offers the greeting or looks up the voice) without pulling the whole recorder into the main
// bundle. recorder.ts re-exports these, so everything else still finds them there.

/** Best first. Only these are accepted by the Worker (webm, mp4, ogg). */
export const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const;

const hasMediaRecorder = () =>
  typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function';

export const hasGetUserMedia = () =>
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

/**
 * Voice needs a microphone API and a recording format the Worker accepts. Without them there is no mic
 * button, no speaker toggle and no spoken replies at all, so nothing voice-related should start.
 */
export const isRecordingSupported = (): boolean => hasGetUserMedia() && pickMimeType() !== null;
