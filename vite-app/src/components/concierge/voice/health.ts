// What the Worker says about voice (GET /health), read once when the page loads so that a click can
// know, without waiting for the network, whether the greeting (and the spoken replies after it) can work.
//
// This is deliberately small and dependency-free: it lives in the always-loaded bubble's bundle, while
// the rest of the network code (api.ts) is in the panel chunk. api.ts re-exports fetchVoiceCaps from here,
// so there is one implementation of the request and of the allow-list that reads the answer.

import { apiBase } from '../config';

// Only decides whether to read replies aloud; never worth making the panel wait.
export const HEALTH_TIMEOUT_MS = 5000;

/**
 * What reads replies aloud (GET /health): audio fetched from the Worker's /tts (whichever provider
 * it uses; the widget does not care which), or nothing (text only). There is no browser voice.
 * Whether the Worker also offers speech to text (`voice.stt`) is none of the widget's business:
 * there is no voice input.
 */
export type VoiceCaps = { tts: 'server' | 'none' };

const asBody = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * What the Worker said about voice, or `undefined` when it said nothing usable. Three outcomes:
 *  - the voice caps: `tts` says whether replies can be read aloud;
 *  - null: it ANSWERED, and the answer is no voice (a 2xx with no voice block, or a 4xx).
 *    Asking again would get the same answer, so nobody should;
 *  - undefined: a failure (unreachable, a timeout, a 5xx, or a 2xx that is not JSON), which is worth asking about
 *    again later.
 * One more try after a network failure, a timeout or a 5xx, since a single dropped request should not cost
 * the visitor the spoken replies for the whole visit. Each try is limited to HEALTH_TIMEOUT_MS, body included.
 */
async function askHealth(): Promise<VoiceCaps | null | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiBase()}/health`, { signal: controller.signal, credentials: 'omit' });
      if (res.status >= 500) continue;
      if (!res.ok) return null;
      let voice: Record<string, unknown> | null;
      try {
        voice = asBody((await res.json())?.voice);
      } catch {
        if (controller.signal.aborted) continue; // it was the timeout that cut the body short
        return undefined; // answered, but not with JSON: not a Worker's answer, and not worth a second try now
      }
      if (!voice) return null;
      // An allow-list: the server voice is on only for exactly "server", and not when the Worker
      // says it is not configured. Anything else ("browser", "none", an older or unknown value,
      // nothing at all) is text only.
      return { tts: voice.tts === 'server' && voice.configured !== false ? 'server' : 'none' };
    } catch {
      // unreachable, or timed out: try once more
    } finally {
      clearTimeout(timer);
    }
  }
  return undefined;
}

/**
 * Whether replies are read aloud. Null for anything else (no voice block, a 4xx, unreachable): the
 * widget then shows no voice controls at all.
 */
export async function fetchVoiceCaps(): Promise<VoiceCaps | null> {
  return (await askHealth()) ?? null;
}

// ---- The page-load answer ----------------------------------------------------------

/**
 * What the page-load request found: `undefined` while it is not known (not asked, in flight, or it failed),
 * null for a definitive "no voice" answer, otherwise the caps.
 */
let answer: VoiceCaps | null | undefined;
/** The page-load request, while it is in flight. */
let inFlight: Promise<void> | null = null;

/** What a click needs to know: not known yet, a server voice, or no server voice (an answer that will not change). */
export const voiceHealth = (): 'unknown' | 'server' | 'none' =>
  answer === undefined ? 'unknown' : answer?.tts === 'server' ? 'server' : 'none';

/**
 * Ask the Worker once whether it has a server voice, so a click can read the answer. The request has its own
 * timeout (5 s per try, one retry); until it answers the greeting simply does not play. Does nothing when the Worker has already
 * answered (including "no voice", which no click should ask about again), or while a request is in flight.
 * A request that failed leaves the answer unknown, so the next click asks again.
 */
export function prefetchVoiceCaps(): void {
  if (inFlight || answer !== undefined) return;
  const request = (inFlight = (async () => {
    try {
      answer = await askHealth();
    } catch {
      // no answer
    }
  })());
  void request.finally(() => {
    if (inFlight === request) inFlight = null;
  });
}

/**
 * The page-load answer for the voice controller's own check, so the Worker is not asked a second time: the
 * caps, or null for a definitive "no voice", or undefined when there is nothing to reuse (nothing was asked,
 * or it failed) and the controller must ask for itself. Waits for a request that is in flight.
 */
export async function sharedVoiceCaps(): Promise<VoiceCaps | null | undefined> {
  if (inFlight) await inFlight;
  return answer;
}

/** Forget the answer, as if the page had just loaded. For tests. */
export function resetVoiceHealth(): void {
  answer = undefined;
  inFlight = null;
}
