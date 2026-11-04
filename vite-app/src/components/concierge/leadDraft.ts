// The lead details the helper has gathered in conversation (plan v1.1 section 1.1).
// The Worker already cleans these; this is the widget's own defensive pass, so a
// strange reply can never put something the form would reject into a field.

import type { LeadDraft } from './types';
import { EMAIL_RE, isCallbackWindow, LIMITS, normalizePhone } from './validation';

export const EMPTY_LEAD_DRAFT: LeadDraft = Object.freeze({
  name: '',
  phone: '',
  email: '',
  business: '',
  need: '',
  callbackWindow: '',
});

/** The six draft fields, in form order. */
export const LEAD_DRAFT_KEYS = Object.keys(EMPTY_LEAD_DRAFT) as Array<keyof LeadDraft>;

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Whatever the server sent as `lead`, as a safe draft (missing or odd fields become ''). */
export function parseLeadDraft(raw: unknown): LeadDraft {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_LEAD_DRAFT };
  const o = raw as Record<string, unknown>;

  // An address that is too long is dropped, not cut: a shortened one is a different address.
  const email = typeof o.email === 'string' ? o.email.trim() : '';
  const callbackWindow = typeof o.callbackWindow === 'string' ? o.callbackWindow : '';
  return {
    name: text(o.name, LIMITS.nameMax),
    phone: typeof o.phone === 'string' ? (normalizePhone(o.phone) ?? '') : '',
    email: email.length <= LIMITS.emailMax && EMAIL_RE.test(email) ? email : '',
    business: text(o.business, LIMITS.businessMax),
    need: text(o.need, LIMITS.needMax),
    callbackWindow: isCallbackWindow(callbackWindow) ? callbackWindow : '',
  };
}

/**
 * `incoming` over `base`, but an empty incoming field never erases a detail already
 * gathered. Fields in `locked` (ones the visitor typed themselves) are never touched.
 */
export function mergeLeadDraft(
  base: LeadDraft,
  incoming: LeadDraft,
  locked?: ReadonlySet<keyof LeadDraft>
): LeadDraft {
  const merged: Record<string, string> = { ...base };
  for (const key of LEAD_DRAFT_KEYS) {
    if (locked?.has(key)) continue;
    if (incoming[key]) merged[key] = incoming[key];
  }
  return merged as unknown as LeadDraft;
}

/**
 * The details that can bring a dismissed form back by being filled in for the first time.
 * Not `need`: it is free text the model re-words on almost every turn, so it says nothing
 * about the visitor having given us more.
 */
const REOPEN_KEYS = ['name', 'phone', 'email', 'business', 'callbackWindow'] as const;

/**
 * After the visitor said "not now", may this reply bring the form back? Only if a detail
 * that was missing when they dismissed it (name, phone, email, business, callback window)
 * has since been given. A changed value for something already filled in does not count (the
 * "Yes, call me" chip covers that), and neither does `need`.
 */
export function fillsMissingDetail(snapshot: LeadDraft, incoming: LeadDraft): boolean {
  return REOPEN_KEYS.some((key) => snapshot[key] === '' && incoming[key] !== '');
}
