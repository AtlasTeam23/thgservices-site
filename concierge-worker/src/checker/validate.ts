import { clampLength, sanitizeText, singleLine, stripControl } from '../sanitize';
import { isRecord } from '../util';
import {
  LIMITS,
  MESSAGES,
  cleanToken,
  isValidEmail,
  normalizePhone,
  type FieldErrors,
} from '../validation';

export const PROFILES = ['trade', 'professional', 'health', 'retail', 'software', 'general'] as const;
export type Profile = (typeof PROFILES)[number];

export const CHECKER_MESSAGES = {
  urlRequired: 'Enter your website address',
  scanInvalid: 'Something went wrong. Please run the check again.',
  industryRequired: 'Choose your industry',
  competitorsInvalid: 'Those competitor checks could not be used. Please run them again.',
} as const;

export const URL_MAX = 2048;
export const LABEL_MAX = 80;
export const MAX_COMPETITORS = 3;
export const BODY_MAX_BYTES = 16 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REPORT_TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

/** Anything that is not one of the six keys means "general". */
export const cleanProfile = (value: unknown): Profile =>
  PROFILES.find((profile) => profile === value) ?? 'general';

/**
 * A short label the visitor chose or typed (industry, city). It ends up in the lead notes and in a
 * model prompt, so it is cut down to letters, digits, spaces and a few plain marks.
 */
export const cleanLabel = (value: unknown, max: number = LABEL_MAX): string => {
  if (typeof value !== 'string' || value.length > max * 4) return '';
  const plain = singleLine(sanitizeText(value)).replace(/[^\p{L}\p{N} &,'./()+-]/gu, '');
  return clampLength(singleLine(plain), max);
};

export interface ScanRequest {
  url: string;
  profile: Profile;
  force: boolean;
  turnstileToken: string | undefined;
  honeypot: boolean;
}

export type ScanValidation = { ok: true; value: ScanRequest } | { ok: false; fields: FieldErrors };

/** True when the hidden field has anything in it: a person never sees it, a bot fills it. */
const honeypotFilled = (input: Record<string, unknown>): boolean => {
  const value = input.company_website;
  return value !== undefined && value !== null && value !== '' && value !== false;
};

export const validateScan = (raw: unknown): ScanValidation => {
  if (!isRecord(raw)) return { ok: false, fields: { url: CHECKER_MESSAGES.urlRequired } };
  const honeypot = honeypotFilled(raw);
  const typed = typeof raw.url === 'string' ? raw.url : '';
  const url = singleLine(stripControl(typed));
  if (!honeypot && (url.length === 0 || typed.length > URL_MAX)) {
    return { ok: false, fields: { url: CHECKER_MESSAGES.urlRequired } };
  }
  return {
    ok: true,
    value: {
      url,
      profile: cleanProfile(raw.profile),
      force: raw.force === true,
      turnstileToken: cleanToken(raw.turnstileToken),
      honeypot,
    },
  };
};

export interface UnlockRequest {
  scanId: string;
  competitors: string[];
  industry: string;
  city: string;
  okToCall: boolean;
  name: string;
  email: string | undefined;
  phone: string | undefined;
  turnstileToken: string | undefined;
  honeypot: boolean;
}

export type UnlockValidation = { ok: true; value: UnlockRequest } | { ok: false; fields: FieldErrors };

/**
 * Validates an unlock request. `gated` comes from the Worker's own reading of the request country,
 * never from the body. Gated: name, a valid email and a 10-digit phone are required, with the same
 * rules and messages as /lead. Not gated: contact fields are optional, only an email that was typed
 * must be valid, and the name and phone are dropped.
 */
export const validateUnlock = (raw: unknown, gated: boolean): UnlockValidation => {
  if (!isRecord(raw)) return { ok: false, fields: { scanId: CHECKER_MESSAGES.scanInvalid } };
  const honeypot = honeypotFilled(raw);
  const token = cleanToken(raw.turnstileToken);
  if (honeypot) {
    return {
      ok: true,
      value: { scanId: '', competitors: [], industry: '', city: '', okToCall: false, name: '', email: undefined, phone: undefined, turnstileToken: token, honeypot },
    };
  }

  const fields: FieldErrors = {};

  const scanId = typeof raw.scanId === 'string' && UUID.test(raw.scanId) ? raw.scanId : '';
  if (scanId === '') fields.scanId = CHECKER_MESSAGES.scanInvalid;

  let competitors: string[] = [];
  if (raw.competitors !== undefined && raw.competitors !== null) {
    if (
      !Array.isArray(raw.competitors) ||
      raw.competitors.length > MAX_COMPETITORS ||
      !raw.competitors.every((id) => typeof id === 'string' && UUID.test(id))
    ) {
      fields.competitors = CHECKER_MESSAGES.competitorsInvalid;
    } else {
      competitors = [...new Set(raw.competitors as string[])].filter((id) => id !== scanId);
    }
  }

  const industry = cleanLabel(raw.industry);
  if (industry === '') fields.industry = CHECKER_MESSAGES.industryRequired;
  const city = cleanLabel(raw.city);

  let name = '';
  let phone: string | undefined;
  if (gated) {
    const rawName = typeof raw.name === 'string' ? raw.name : '';
    name = rawName.length > LIMITS.nameMax * 4 ? '' : singleLine(sanitizeText(rawName));
    if (rawName.length > LIMITS.nameMax * 4 || name.length > LIMITS.nameMax) fields.name = MESSAGES.nameTooLong;
    else if (name.length === 0) fields.name = MESSAGES.nameRequired;

    const normalized = typeof raw.phone === 'string' ? normalizePhone(raw.phone) : null;
    if (normalized === null) fields.phone = MESSAGES.phoneInvalid;
    else phone = normalized;
  }

  let email: string | undefined;
  const typedEmail = typeof raw.email === 'string' ? raw.email.trim() : '';
  if (typedEmail !== '') {
    if (isValidEmail(typedEmail)) email = typedEmail;
    else fields.email = MESSAGES.emailInvalid;
  } else if (gated) {
    fields.email = MESSAGES.emailInvalid;
  }
  if (raw.email !== undefined && raw.email !== null && typeof raw.email !== 'string') fields.email = MESSAGES.emailInvalid;

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    value: { scanId, competitors, industry, city, okToCall: raw.okToCall === true, name, email, phone, turnstileToken: token, honeypot },
  };
};

/** The visitor's country code from Cloudflare, upper case, or null when missing or unknown (XX, T1). */
export const requestCountry = (request: Request): string | null => {
  const country = (request.cf as { country?: unknown } | undefined)?.country;
  if (typeof country !== 'string') return null;
  const code = country.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'T1' ? code : null;
};

/** Gated (the contact form is required) for visitors in the US and for visitors whose country is unknown. */
export const isGated = (request: Request): boolean => {
  const country = requestCountry(request);
  return country === null || country === 'US';
};
