// What the Worker says about voice (GET /health), read once when the page loads so that a click can
// know, without waiting for the network, whether the greeting (and the spoken replies after it) can work.
//
// This is deliberately small and dependency-free: it lives in the always-loaded bubble's bundle, while
// the rest of the network code (api.ts) is in the panel chunk. api.ts re-exports fetchVoiceCaps from here,
// so there is one implementation of the request and of the allow-list that reads the answer.

import { apiBase } from '../config';
import { isRecordingSupported } from './support';

// Only decides whether to show the mic; never worth making the panel wait.
export const HEALTH_TIMEOUT_MS = 5000;

/**
 * What reads replies aloud (GET /health), given that the Worker offers speech to text at all:
 * audio fetched from the Worker's /tts (whichever provider it uses; the widget does not care
 * which), or nothing (text only). There is no browser voice.
 */
export type VoiceCaps = { tts: 'server' | 'none' };

const asBody = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Whether the Worker offers speech to text, and whether replies are read aloud. Null for
 * anything else (no voice block, `stt: false`, a 4xx, unreachable): the widget then shows
 * no voice controls at all. One more try after a network failure, a timeout or a 5xx, since
 * a single dropped request should not cost the visitor the mic for the whole visit. Each try
 * is limited to HEALTH_TIMEOUT_MS, body included.
 */
export async function fetchVoiceCaps(): Promise<VoiceCaps | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiBase()}/health`, { signal: controller.signal, credentials: 'omit' });
      if (res.status >= 500) continue;
      if (res.status !== 200) return null;
      let voice: Record<string, unknown> | null = null;
      try {
        voice = asBody((await res.json())?.voice);
      } catch {
        if (controller.signal.aborted) continue; // it was the timeout that cut the body short
      }
      if (!voice || voice.stt !== true) return null;
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
  return null;
}

// ---- The page-load answer ----------------------------------------------------------

/** What the page-load request found: not known (not asked, in flight, or it failed), a server voice, or none. */
let health: 'unknown' | 'server' | 'none' = 'unknown';
/** The page-load request, while it is in flight. */
let inFlight: Promise<VoiceCaps | null> | null = null;

export const voiceHealth = (): 'unknown' | 'server' | 'none' => health;

/**
 * Ask the Worker once whether it has a server voice, so a click can read the answer. fetchVoiceCaps()
 * has its own timeout (5 s per try, one retry); until it answers the greeting simply does not play.
 * Does nothing in a browser that cannot record (no mic, no spoken replies: nothing to ask about), when
 * the answer is already known, or while a request is in flight. A failed request leaves the answer
 * "unknown", so asking again later (the next click) tries again.
 */
export function prefetchVoiceCaps(): void {
  if (inFlight || health !== 'unknown' || !isRecordingSupported()) return;
  const request = (inFlight = (async (): Promise<VoiceCaps | null> => {
    let caps: VoiceCaps | null = null;
    try {
      caps = await fetchVoiceCaps();
    } catch {
      // treated as "no answer"
    }
    if (caps) health = caps.tts;
    return caps;
  })());
  void request.finally(() => {
    if (inFlight === request) inFlight = null;
  });
}

/**
 * The page-load answer for the voice controller's own check, so the Worker is not asked a second time:
 * the request in flight, or the answer it brought, or null when there is none to reuse (nothing was asked,
 * or it failed). The controller then asks for itself.
 */
export async function sharedVoiceCaps(): Promise<VoiceCaps | null> {
  if (inFlight) return inFlight;
  return health === 'unknown' ? null : { tts: health };
}

/** Forget the answer, as if the page had just loaded. For tests. */
export function resetVoiceHealth(): void {
  health = 'unknown';
  inFlight = null;
}
