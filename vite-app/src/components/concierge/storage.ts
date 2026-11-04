// Per-tab persistence (plan section 2.9). Every read and write is wrapped:
// the widget must work with storage disabled.

import { parseLeadDraft } from './leadDraft';
import type { LeadDraft, Message } from './types';
import { sanitizeUtm } from './validation';

export const STORAGE_KEY = 'thg-concierge-v1';
const MAX_STORED_MESSAGES = 100;

export type StoredState = {
  sessionId: string;
  messages: Message[];
  leadSubmitted: boolean;
  ended: boolean;
  utm: Record<string, string>;
  /**
   * Id of the last message when the visitor dismissed the lead form ("Not now, keep
   * chatting"). A reload that still ends on that message does not bring the form back.
   * Additive: absent unless a dismissal happened, so the v1 shape stays readable.
   */
  leadFormDismissedAfter?: string;
  /**
   * Id of the last message when a readyToConfirm form was open, and the details it was
   * pre-filled with (the transcript holds the same data). A reload that still ends on that
   * message brings the form back as it was. Both cleared when the lead is sent or the form
   * dismissed. Additive: absent unless such a form is open.
   */
  leadFormOpenAfter?: string;
  leadDraft?: LeadDraft;
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** crypto.randomUUID when available, otherwise a Math.random-based v4. */
export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Only utm_* query parameters. */
export function captureUtm(search: string): Record<string, string> {
  const raw: Record<string, string> = {};
  try {
    new URLSearchParams(search).forEach((value, key) => {
      if (!(key in raw)) raw[key] = value;
    });
  } catch {
    // ignore malformed query strings
  }
  return sanitizeUtm(raw);
}

function freshState(): StoredState {
  return {
    sessionId: newId(),
    messages: [],
    leadSubmitted: false,
    ended: false,
    utm: typeof window !== 'undefined' ? captureUtm(window.location.search) : {},
  };
}

const nonEmptyString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

function isMessage(m: unknown): m is Message {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    (o.role === 'user' || o.role === 'assistant') &&
    typeof o.content === 'string' &&
    typeof o.at === 'string'
  );
}

export function loadState(): StoredState {
  const fresh = freshState();
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fresh;
    const o = parsed as Record<string, unknown>;
    if (typeof o.sessionId !== 'string') return fresh;
    return {
      // The id goes to the server, so anything that is not a v4 UUID is replaced.
      sessionId: UUID_V4.test(o.sessionId) ? o.sessionId : fresh.sessionId,
      messages: Array.isArray(o.messages) ? o.messages.filter(isMessage) : [],
      leadSubmitted: o.leadSubmitted === true,
      ended: o.ended === true,
      utm:
        o.utm && typeof o.utm === 'object'
          ? sanitizeUtm(o.utm as Record<string, unknown>)
          : {},
      leadFormDismissedAfter: nonEmptyString(o.leadFormDismissedAfter),
      leadFormOpenAfter: nonEmptyString(o.leadFormOpenAfter),
      leadDraft:
        o.leadDraft &&
        typeof o.leadDraft === 'object' &&
        !Array.isArray(o.leadDraft) &&
        Object.keys(o.leadDraft).length > 0
          ? parseLeadDraft(o.leadDraft)
          : undefined,
    };
  } catch {
    return fresh;
  }
}

export function saveState(state: StoredState): void {
  try {
    const trimmed: StoredState = {
      ...state,
      messages: state.messages.slice(-MAX_STORED_MESSAGES),
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // storage disabled or full; the in-memory state still works
  }
}

/**
 * Remember where the visitor arrived from. Called once when the page loads, so
 * the UTM parameters are captured even if the chat is opened much later (after
 * the URL has changed). Does nothing if this tab already has a stored session.
 */
export function captureLanding(): void {
  try {
    if (window.sessionStorage.getItem(STORAGE_KEY)) return;
  } catch {
    return;
  }
  saveState(freshState());
}
