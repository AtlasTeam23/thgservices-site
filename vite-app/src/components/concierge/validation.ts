// Client-side mirror of the Worker's /lead rules (plan section 2.1). Keep the
// two in step: the server is the source of truth, this only saves a round trip.

import { WINDOW_KEYS } from './copy';
import type {
  CallbackWindow,
  FieldErrors,
  LeadInput,
  Message,
  TranscriptEntry,
} from './types';

export const LIMITS = {
  nameMax: 80,
  businessMax: 120,
  needMax: 500,
  emailMax: 254,
  messageMax: 1000,
  transcriptMax: 60,
  pageUrlMax: 500,
  utmMaxKeys: 10,
  utmValueMax: 100,
  utmKeyMax: 40,
} as const;

/** The fields the lead form renders, in tab order. */
export const FORM_FIELDS = [
  'name',
  'phone',
  'email',
  'business',
  'need',
  'callbackWindow',
  'consent',
] as const satisfies readonly (keyof LeadInput)[];

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Raw values as typed into the form. */
export type LeadFormValues = {
  name: string;
  phone: string;
  email: string;
  business: string;
  need: string;
  callbackWindow: string;
  consent: boolean;
};

export const isCallbackWindow = (v: string): v is CallbackWindow =>
  (WINDOW_KEYS as readonly string[]).includes(v);

/**
 * Returns exactly 10 digits, or null. A leading 1 on 11 digits is allowed
 * and dropped.
 */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
}

/** Exactly 10 digits as "(770) 555-0147"; anything else is returned untouched. */
export function formatPhone(value: string): string {
  const m = /^(\d{3})(\d{3})(\d{4})$/.exec(value);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : value;
}

export type LeadValidation =
  | { ok: true; value: LeadInput }
  | { ok: false; fields: FieldErrors };

export function validateLead(values: LeadFormValues): LeadValidation {
  const fields: FieldErrors = {};

  const name = values.name.trim();
  if (name.length < 1) fields.name = 'Enter your name';
  else if (name.length > LIMITS.nameMax)
    fields.name = `Keep your name under ${LIMITS.nameMax} characters`;

  const phone = normalizePhone(values.phone);
  if (!phone) fields.phone = 'Enter a 10-digit US phone number';

  const email = values.email.trim();
  if (email && !EMAIL_RE.test(email)) fields.email = 'Enter a valid email address';

  const business = values.business.trim();
  if (business.length < 1) fields.business = 'Enter your business name';
  else if (business.length > LIMITS.businessMax)
    fields.business = `Keep this under ${LIMITS.businessMax} characters`;

  const need = values.need.trim();
  if (need.length > LIMITS.needMax)
    fields.need = `Keep this under ${LIMITS.needMax} characters`;

  if (!isCallbackWindow(values.callbackWindow))
    fields.callbackWindow = 'Pick a callback window';

  if (values.consent !== true) fields.consent = 'Check this box so we can contact you';

  if (Object.keys(fields).length > 0 || !phone || !isCallbackWindow(values.callbackWindow)) {
    return { ok: false, fields };
  }

  const value: LeadInput = {
    name,
    phone,
    business,
    callbackWindow: values.callbackWindow,
    consent: true,
  };
  if (email) value.email = email;
  if (need) value.need = need;
  return { ok: true, value };
}

/** Visible thread to lead transcript: no greeting, last 60, each entry <= 1,000 chars. */
export function buildTranscript(messages: Message[]): TranscriptEntry[] {
  return messages
    .filter((m) => !m.greeting)
    .slice(-LIMITS.transcriptMax)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, LIMITS.messageMax),
      at: m.at,
    }));
}

/** Only utm_ keys, at most 10, values at most 100 characters. */
export function sanitizeUtm(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= LIMITS.utmMaxKeys) break;
    if (!key.startsWith('utm_') || key.length > LIMITS.utmKeyMax) continue;
    if (typeof value !== 'string') continue;
    out[key] = value.slice(0, LIMITS.utmValueMax);
  }
  return out;
}
