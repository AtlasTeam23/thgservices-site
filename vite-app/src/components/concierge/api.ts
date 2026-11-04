// Network layer for the chat widget (plan section 2.1) and for push-to-talk voice
// (voice plan sections 1.1 to 1.3). No function here throws: every outcome is a
// typed result the state machine can switch on.

import { apiBase } from './config';
import { parseLeadDraft } from './leadDraft';
import type {
  ChatRequest,
  ChatResponse,
  Intent,
  LeadDelivery,
  LeadRequest,
} from './types';

export const CHAT_TIMEOUT_MS = 15000;
// A lead may wait on email delivery and one retry server-side.
export const LEAD_TIMEOUT_MS = 30000;
// The Worker gives each Workers AI attempt 8 s and does not retry after a timeout, so a
// transcript is back within about 8 s of the upload reaching it. 20 s adds room for a slow
// mobile upload of a full-length clip (80 KB at 32 kbps) without hanging the "Transcribing…" state.
export const STT_TIMEOUT_MS = 20000;
// One 8 s model attempt; past that the browser voice reads the reply instead.
export const TTS_TIMEOUT_MS = 8000;
// Only decides whether to show the mic; never worth making the panel wait.
export const HEALTH_TIMEOUT_MS = 5000;
/** The Worker refuses longer clips; keep the figure we report inside its limit. */
export const MAX_REPORTED_DURATION_MS = 20000;

const INTENTS: readonly Intent[] = [
  'answer',
  'pricing',
  'off_topic',
  'handoff',
  'unsure',
  'collecting',
];
const DELIVERIES: readonly LeadDelivery[] = ['email', 'email+leadquik', 'leadquik'];

export type ChatResult =
  | { kind: 'ok'; data: ChatResponse }
  | { kind: 'rate_limited'; reply?: string }
  | { kind: 'verification_required' }
  | { kind: 'ended'; reply?: string }
  | { kind: 'lead_only'; reply?: string }
  | { kind: 'too_long'; reply?: string }
  | { kind: 'error'; reason: 'network' | 'timeout' | 'bad_request' | 'server' };

export type SttResult =
  | { kind: 'ok'; text: string; durationMs: number | null }
  | { kind: 'bad_audio' }
  | { kind: 'verification_required' }
  | { kind: 'rate_limited' }
  /** `budget`: the day's allowance is spent. `server`: Workers AI is failing (or there is no /stt at all). */
  | { kind: 'voice_unavailable'; reason: 'budget' | 'server' }
  | { kind: 'error'; reason: 'network' | 'timeout' | 'server' };

/**
 * `limit`: the visitor's daily allowance of spoken replies is used up (429 tts_limit);
 * `bonusAvailable` says whether sharing contact details would add more, and `bonus`, when the
 * Worker says so, how many. Anything else that is not audio is `unavailable`, and that reply
 * simply stays text.
 */
export type TtsResult =
  | { kind: 'ok'; blob: Blob }
  | { kind: 'limit'; bonusAvailable: boolean; bonus?: number }
  | { kind: 'unavailable' };

/**
 * What reads replies aloud (GET /health), given that the Worker offers speech to text at all:
 * audio fetched from the Worker's /tts (whichever provider it uses; the widget does not care
 * which), or nothing (text only). There is no browser voice.
 */
export type VoiceCaps = { tts: 'server' | 'none' };

/** How many spoken replies a bonus adds, if the Worker says: a whole number from 1 to 100. */
const asBonusCount = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100 ? v : undefined;

export type LeadResult =
  | { kind: 'ok'; delivery: LeadDelivery }
  | { kind: 'validation'; fields: Record<string, string> }
  | { kind: 'verification_failed' }
  | { kind: 'rate_limited' }
  | { kind: 'delivery_failed' }
  | { kind: 'error'; reason: 'network' | 'timeout' | 'server' };

type Body = Record<string, unknown>;
type Transport<T = Body | null> =
  | { ok: true; status: number; body: T }
  | { ok: false; reason: 'network' | 'timeout' };

const asBody = (v: unknown): Body | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Body) : null;

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

/**
 * One request with a timeout covering the whole exchange, body included. `read`
 * turns the response into a value; if it throws, `fallback` stands in (unless the
 * timeout is what broke it).
 */
async function call<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  read: (res: Response) => Promise<T>,
  fallback: T,
  /** Cancels the request when the caller no longer wants the answer. */
  external?: AbortSignal
): Promise<Transport<T>> {
  if (external?.aborted) return { ok: false, reason: 'network' };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  external?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const res = await fetch(`${apiBase()}${path}`, {
      ...init,
      signal: controller.signal,
      credentials: 'omit',
    });
    let body = fallback;
    try {
      body = await read(res);
    } catch {
      if (timedOut) return { ok: false, reason: 'timeout' };
    }
    return { ok: true, status: res.status, body };
  } catch {
    return { ok: false, reason: timedOut ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onExternalAbort);
  }
}

// Duck-typed: a Blob from another realm (an iframe, a test runner) fails `instanceof Blob`.
const isBlob = (v: unknown): v is Blob =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as Blob).size === 'number' &&
  typeof (v as Blob).arrayBuffer === 'function';

const readJson = async (res: Response): Promise<Body | null> => asBody(await res.json());

const post = (path: string, payload: unknown, timeoutMs: number) =>
  call(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    timeoutMs,
    readJson,
    null
  );

export async function postChat(req: ChatRequest): Promise<ChatResult> {
  const res = await post('/chat', req, CHAT_TIMEOUT_MS);
  if (!res.ok) return { kind: 'error', reason: res.reason };

  const { status, body } = res;
  const error = asString(body?.error);
  const reply = asString(body?.reply);

  if (status === 200) {
    if (!reply) return { kind: 'error', reason: 'server' };
    const intent = INTENTS.find((i) => i === body?.intent) ?? 'answer';
    return {
      kind: 'ok',
      data: {
        reply,
        intent,
        offerCallback: body?.offerCallback === true,
        // Servers before plan v1.1 send neither field: no lead, nothing to confirm.
        readyToConfirm: body?.readyToConfirm === true,
        lead: parseLeadDraft(body?.lead),
      },
    };
  }
  if (status === 429) return { kind: 'rate_limited', reply };
  if (status === 503) return { kind: 'lead_only', reply };
  if (status === 403) {
    if (error === 'verification_required') return { kind: 'verification_required' };
    if (error === 'ended') return { kind: 'ended', reply };
    return { kind: 'error', reason: 'server' };
  }
  if (status === 400) {
    if (error === 'message_too_long') return { kind: 'too_long', reply };
    return { kind: 'error', reason: 'bad_request' };
  }
  return { kind: 'error', reason: 'server' };
}

export async function postLead(req: LeadRequest): Promise<LeadResult> {
  const res = await post('/lead', req, LEAD_TIMEOUT_MS);
  if (!res.ok) return { kind: 'error', reason: res.reason };

  const { status, body } = res;
  if (status === 200 && body?.ok === true) {
    const delivery = DELIVERIES.find((d) => d === body.delivery);
    if (delivery) return { kind: 'ok', delivery };
    return { kind: 'error', reason: 'server' };
  }
  if (status === 400 && body?.error === 'validation') {
    const fields: Record<string, string> = {};
    const raw = asBody(body.fields);
    if (raw) {
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string') fields[key] = value;
      }
    }
    return { kind: 'validation', fields };
  }
  if (status === 403 && body?.error === 'verification_failed') {
    return { kind: 'verification_failed' };
  }
  if (status === 429) return { kind: 'rate_limited' };
  if (status === 502) return { kind: 'delivery_failed' };
  return { kind: 'error', reason: 'server' };
}

// File names and bare MIME types for the multipart upload. The recorder reports a
// full type such as "audio/webm;codecs=opus"; the Worker allows the bare types only.
const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
};

const bareMime = (mime: string): string => mime.split(';')[0].trim().toLowerCase();

/**
 * Speech to text. `durationMs` is the client's own measurement of the clip; the
 * Worker uses it for the daily voice budget, so send it when it is known.
 */
export async function postStt(
  blob: Blob,
  mime: string,
  sessionId: string,
  token?: string | null,
  durationMs?: number
): Promise<SttResult> {
  const type = bareMime(mime);
  const form = new FormData();
  form.append('audio', new Blob([blob], { type }), `speech.${AUDIO_EXTENSIONS[type] ?? 'bin'}`);
  form.append('sessionId', sessionId);
  if (token) form.append('turnstileToken', token);
  if (typeof durationMs === 'number' && Number.isFinite(durationMs)) {
    form.append(
      'durationMs',
      String(Math.min(MAX_REPORTED_DURATION_MS, Math.max(0, Math.round(durationMs))))
    );
  }

  // No Content-Type header: the browser adds the multipart boundary itself.
  const res = await call('/stt', { method: 'POST', body: form }, STT_TIMEOUT_MS, readJson, null);
  if (!res.ok) return { kind: 'error', reason: res.reason };

  const { status, body } = res;
  const error = asString(body?.error);

  if (status === 200) {
    if (typeof body?.text !== 'string') return { kind: 'error', reason: 'server' };
    return {
      kind: 'ok',
      text: body.text,
      durationMs: typeof body.durationMs === 'number' ? body.durationMs : null,
    };
  }
  if (status === 400 && error === 'bad_audio') return { kind: 'bad_audio' };
  if (status === 403 && error === 'verification_required') return { kind: 'verification_required' };
  if (status === 429) return { kind: 'rate_limited' };
  if (status === 503) {
    return { kind: 'voice_unavailable', reason: body?.reason === 'budget' ? 'budget' : 'server' };
  }
  // A Worker from before voice has no /stt route, which is the same thing to the visitor.
  if (status === 404) return { kind: 'voice_unavailable', reason: 'server' };
  return { kind: 'error', reason: 'server' };
}

/** The server voice (only called when /health says the voice is not the browser's). */
export async function fetchTts(
  text: string,
  sessionId: string,
  signal?: AbortSignal
): Promise<TtsResult> {
  const res = await call<Blob | Body | null>(
    '/tts',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, text }),
    },
    TTS_TIMEOUT_MS,
    async (r) => (r.status === 200 ? r.blob() : readJson(r)),
    null,
    signal
  );
  if (!res.ok) return { kind: 'unavailable' };
  if (res.status === 200 && isBlob(res.body) && res.body.size > 0) {
    return { kind: 'ok', blob: res.body };
  }
  if (res.status === 429 && !isBlob(res.body) && res.body?.error === 'tts_limit') {
    const bonus = asBonusCount(res.body.bonus);
    return {
      kind: 'limit',
      bonusAvailable: res.body.bonusAvailable === true,
      ...(bonus !== undefined ? { bonus } : {}),
    };
  }
  return { kind: 'unavailable' };
}

/**
 * Whether the Worker offers speech to text, and whether replies are read aloud. Null for
 * anything else (no voice block, `stt: false`, a 4xx, unreachable): the widget then shows
 * no voice controls at all. One more try after a network failure, a timeout or a 5xx, since
 * a single dropped request should not cost the visitor the mic for the whole visit.
 */
export async function fetchVoiceCaps(): Promise<VoiceCaps | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await call('/health', { method: 'GET' }, HEALTH_TIMEOUT_MS, readJson, null);
    if (!res.ok || res.status >= 500) continue;
    if (res.status !== 200) return null;
    const voice = asBody(res.body?.voice);
    if (!voice || voice.stt !== true) return null;
    // An allow-list: the server voice is on only for exactly "server", and not when the Worker
    // says it is not configured. Anything else ("browser", "none", an older or unknown value,
    // nothing at all) is text only.
    return { tts: voice.tts === 'server' && voice.configured !== false ? 'server' : 'none' };
  }
  return null;
}
