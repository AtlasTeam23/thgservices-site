// Network layer for the chat widget (plan section 2.1). Neither function
// throws: every outcome is a typed result the state machine can switch on.

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

export type LeadResult =
  | { kind: 'ok'; delivery: LeadDelivery }
  | { kind: 'validation'; fields: Record<string, string> }
  | { kind: 'verification_failed' }
  | { kind: 'rate_limited' }
  | { kind: 'delivery_failed' }
  | { kind: 'error'; reason: 'network' | 'timeout' | 'server' };

type Body = Record<string, unknown>;
type Transport =
  | { ok: true; status: number; body: Body | null }
  | { ok: false; reason: 'network' | 'timeout' };

const asBody = (v: unknown): Body | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Body) : null;

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

async function post(path: string, payload: unknown, timeoutMs: number): Promise<Transport> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      credentials: 'omit',
    });
    let body: Body | null = null;
    try {
      body = asBody(await res.json());
    } catch {
      if (timedOut) return { ok: false, reason: 'timeout' };
    }
    return { ok: true, status: res.status, body };
  } catch {
    return { ok: false, reason: timedOut ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

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
