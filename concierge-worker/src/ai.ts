// Helpers shared by the two Workers AI routes, /stt and /tts.
import { json } from './http';

/** Seams for tests: no retry delay, a short timeout. Production uses `{}`. */
export interface VoiceDeps {
  retryDelayMs?: number;
  /** Per-attempt timeout for a Workers AI call. */
  timeoutMs?: number;
}

/**
 * How long one Workers AI call may take. 8 seconds, and a timeout is never retried (only a quicker
 * failure is), so the worst case is a failure just before 8 s, a 0.4 s pause and a second full timeout:
 * about 16.4 s, inside the widget's own 20 s.
 */
export const AI_ATTEMPT_TIMEOUT_MS = 8_000;

export class AiTimeoutError extends Error {
  override readonly name = 'AiTimeoutError';
}

/**
 * Runs one Workers AI call and gives up after `timeoutMs`: the signal handed to `work` is aborted
 * and the result is an AiTimeoutError, so a stuck call cannot hold the request open. The timer is
 * always cleared, so a call that finishes in time is never aborted afterwards (a streamed body keeps
 * flowing).
 */
export const withTimeout = async <T>(timeoutMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AiTimeoutError('workers ai call timed out'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Why voice is off, for the widget's analytics and copy: "budget" when a seconds or characters budget is
 * spent (or set to 0), "server" when the Worker or Workers AI cannot do it (no binding, the model failed,
 * the limiter is down).
 */
export type UnavailableReason = 'budget' | 'server';

/** The 503 both voice routes answer when voice is off: the widget hides the mic for the session. */
export const unavailable = (reason: UnavailableReason): Response => json({ error: 'voice_unavailable', reason }, 503);
