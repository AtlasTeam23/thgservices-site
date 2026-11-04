import { clampLength, sanitizeText, singleLine } from './sanitize';

// Pure request validators for POST /chat and POST /lead. The browser applies the
// same rules (vite-app/src/components/concierge/validation.ts) so the visitor sees
// the same messages whether the check fails there or here.

export const LIMITS = {
  chatMaxMessages: 25,
  userMessageMax: 1000,
  assistantMessageMax: 2000,
  recentUserTurns: 12,
  nameMax: 80,
  businessMax: 120,
  needMax: 500,
  emailMax: 254,
  transcriptMaxEntries: 60,
  transcriptContentMax: 1000,
  pageUrlMax: 500,
  utmMaxKeys: 10,
  utmValueMax: 100,
  utmKeyMax: 50,
  tokenMax: 2048,
} as const;

/**
 * Strings are rejected, before any sanitizing, once they are longer than this many times
 * their field limit. Markup stripping can legitimately shrink a string, so the guard is
 * generous, but it keeps hostile megabyte-sized values away from the sanitizer.
 */
const RAW_FACTOR = 4;
const rawTooLong = (value: string, limit: number): boolean => value.length > limit * RAW_FACTOR;

export const CALLBACK_WINDOWS = ['morning_9_11', 'midday_11_1', 'afternoon_1_3', 'late_afternoon_3_5'] as const;
export type CallbackWindow = (typeof CALLBACK_WINDOWS)[number];

/** Per-field messages returned in `fields` on a 400 from /lead. */
export const MESSAGES = {
  nameRequired: 'Please enter your name',
  nameTooLong: 'Name must be 80 characters or fewer',
  phoneInvalid: 'Enter a 10-digit US phone number',
  emailInvalid: 'Enter a valid email address',
  businessRequired: 'Please enter your business name',
  businessTooLong: 'Business name must be 120 characters or fewer',
  needTooLong: 'Please keep this to 500 characters or fewer',
  callbackWindowRequired: 'Choose a callback window',
  consentRequired: 'Please check the box so we can contact you',
  sessionInvalid: 'Something went wrong with this chat session. Please reload the page and try again.',
  transcriptInvalid: 'The chat transcript could not be read',
  pageInvalid: 'The page details could not be read',
} as const;

export type FieldErrors = Record<string, string>;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatPayload {
  sessionId: string;
  messages: ChatMessage[];
  turnstileToken?: string;
}

export type ChatValidation =
  | { ok: true; value: ChatPayload }
  | { ok: false; error: 'bad_request' | 'message_too_long' };

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  content: string;
  /** ISO-8601, or '' when the client sent something unparseable. */
  at: string;
}

export interface LeadPayload {
  sessionId: string;
  name: string;
  /** Exactly 10 digits. */
  phone: string;
  email?: string;
  business: string;
  need: string;
  callbackWindow: CallbackWindow;
  consent: true;
  transcript: TranscriptEntry[];
  page: { url: string; utm: Record<string, string> };
  turnstileToken?: string;
}

export type LeadValidation = { ok: true; value: LeadPayload } | { ok: false; fields: FieldErrors };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Same shape as the contract's /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, minus the characters that could
// split one address into several (, ;), build a display name (< >), or break out of a quoted
// header or an href ("). The address ends up in reply_to and in a mailto: link.
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/;
const UTM_KEY = /^utm_[a-z0-9_-]+$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const token = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= LIMITS.tokenMax ? value : undefined;

export const isValidSessionId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

/** 10 digits after dropping punctuation and one leading country-code 1; otherwise null. */
export const normalizePhone = (raw: string): string | null => {
  if (raw.length > 40) return null;
  const digits = raw.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return national.length === 10 ? national : null;
};

export const isValidEmail = (value: string): boolean =>
  value.length <= LIMITS.emailMax && EMAIL.test(value);

export const validateChat = (input: unknown): ChatValidation => {
  const bad = { ok: false, error: 'bad_request' } as const;
  if (!isRecord(input) || !isValidSessionId(input.sessionId)) return bad;
  const raw = input.messages;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LIMITS.chatMaxMessages) return bad;

  const messages: ChatMessage[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.content !== 'string') return bad;
    if (item.role !== 'user' && item.role !== 'assistant') return bad;
    if (item.role === 'user' && rawTooLong(item.content, LIMITS.userMessageMax)) {
      return { ok: false, error: 'message_too_long' };
    }
    if (item.role === 'assistant' && rawTooLong(item.content, LIMITS.assistantMessageMax)) return bad;
    const content = sanitizeText(item.content);
    if (item.role === 'user' && content.length > LIMITS.userMessageMax) {
      return { ok: false, error: 'message_too_long' };
    }
    if (content.length === 0) continue; // empty once sanitized: nothing to forward
    messages.push({
      role: item.role,
      content: item.role === 'assistant' ? clampLength(content, LIMITS.assistantMessageMax) : content,
    });
  }

  // The thread must end with something the visitor actually typed.
  if (messages.at(-1)?.role !== 'user') return bad;

  const value: ChatPayload = { sessionId: input.sessionId, messages };
  const turnstileToken = token(input.turnstileToken);
  if (turnstileToken) value.turnstileToken = turnstileToken;
  return { ok: true, value };
};

/**
 * Keeps the last 12 user turns (each user message plus the replies after it), so a
 * full 25-entry thread loses its oldest pair. The result always starts with a user
 * message, which the model API requires.
 */
export const selectRecentTurns = (messages: ChatMessage[]): ChatMessage[] => {
  let seen = 0;
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      seen += 1;
      if (seen === LIMITS.recentUserTurns) {
        start = i;
        break;
      }
    }
  }
  const recent = messages.slice(start);
  const firstUser = recent.findIndex((message) => message.role === 'user');
  return firstUser > 0 ? recent.slice(firstUser) : recent;
};

const validateTranscript = (raw: unknown): TranscriptEntry[] | null => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > LIMITS.transcriptMaxEntries) return null;
  const entries: TranscriptEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.content !== 'string') return null;
    if (item.role !== 'user' && item.role !== 'assistant') return null;
    if (rawTooLong(item.content, LIMITS.transcriptContentMax)) return null;
    const content = sanitizeText(item.content);
    if (content.length > LIMITS.transcriptContentMax) return null;
    if (content.length === 0) continue;
    const parsed = typeof item.at === 'string' ? new Date(item.at) : null;
    entries.push({
      role: item.role,
      content,
      at: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : '',
    });
  }
  return entries;
};

const validatePage = (raw: unknown): LeadPayload['page'] | null => {
  if (raw === undefined || raw === null) return { url: '', utm: {} };
  if (!isRecord(raw)) return null;
  const url = raw.url === undefined || raw.url === null ? '' : raw.url;
  if (typeof url !== 'string' || url.length > LIMITS.pageUrlMax) return null;

  const utm: Record<string, string> = {};
  const rawUtm = raw.utm;
  if (rawUtm !== undefined && rawUtm !== null) {
    if (!isRecord(rawUtm)) return null;
    for (const [key, value] of Object.entries(rawUtm)) {
      if (!UTM_KEY.test(key) || key.length > LIMITS.utmKeyMax) continue; // only utm_* is kept
      if (typeof value !== 'string' || value.length > LIMITS.utmValueMax) return null;
      utm[key.toLowerCase()] = singleLine(sanitizeText(value));
    }
    if (Object.keys(utm).length > LIMITS.utmMaxKeys) return null;
  }
  return { url: singleLine(sanitizeText(url)), utm };
};

export const validateLead = (input: unknown): LeadValidation => {
  // Not an object at all: nothing to attach a per-field message to.
  if (!isRecord(input)) return { ok: false, fields: {} };
  const fields: FieldErrors = {};

  if (!isValidSessionId(input.sessionId)) fields.sessionId = MESSAGES.sessionInvalid;

  const rawName = typeof input.name === 'string' ? input.name : '';
  const name = rawTooLong(rawName, LIMITS.nameMax) ? '' : singleLine(sanitizeText(rawName));
  if (rawTooLong(rawName, LIMITS.nameMax)) fields.name = MESSAGES.nameTooLong;
  else if (name.length === 0) fields.name = MESSAGES.nameRequired;
  else if (name.length > LIMITS.nameMax) fields.name = MESSAGES.nameTooLong;

  const phone = typeof input.phone === 'string' ? normalizePhone(input.phone) : null;
  if (phone === null) fields.phone = MESSAGES.phoneInvalid;

  let email: string | undefined;
  if (input.email !== undefined && input.email !== null && input.email !== '') {
    const candidate = typeof input.email === 'string' ? input.email.trim() : '';
    if (isValidEmail(candidate)) email = candidate;
    else fields.email = MESSAGES.emailInvalid;
  }

  const rawBusiness = typeof input.business === 'string' ? input.business : '';
  const business = rawTooLong(rawBusiness, LIMITS.businessMax) ? '' : singleLine(sanitizeText(rawBusiness));
  if (rawTooLong(rawBusiness, LIMITS.businessMax)) fields.business = MESSAGES.businessTooLong;
  else if (business.length === 0) fields.business = MESSAGES.businessRequired;
  else if (business.length > LIMITS.businessMax) fields.business = MESSAGES.businessTooLong;

  const rawNeed = typeof input.need === 'string' ? input.need : '';
  const need = rawTooLong(rawNeed, LIMITS.needMax) ? '' : sanitizeText(rawNeed);
  if (rawTooLong(rawNeed, LIMITS.needMax) || need.length > LIMITS.needMax) fields.need = MESSAGES.needTooLong;

  const callbackWindow = CALLBACK_WINDOWS.find((window) => window === input.callbackWindow);
  if (callbackWindow === undefined) fields.callbackWindow = MESSAGES.callbackWindowRequired;

  if (input.consent !== true) fields.consent = MESSAGES.consentRequired;

  const transcript = validateTranscript(input.transcript);
  if (transcript === null) fields.transcript = MESSAGES.transcriptInvalid;

  const page = validatePage(input.page);
  if (page === null) fields.page = MESSAGES.pageInvalid;

  if (
    Object.keys(fields).length > 0 ||
    phone === null ||
    callbackWindow === undefined ||
    transcript === null ||
    page === null
  ) {
    return { ok: false, fields };
  }

  const value: LeadPayload = {
    sessionId: input.sessionId as string,
    name,
    phone,
    business,
    need,
    callbackWindow,
    consent: true,
    transcript,
    page,
  };
  if (email) value.email = email;
  const turnstileToken = token(input.turnstileToken);
  if (turnstileToken) value.turnstileToken = turnstileToken;
  return { ok: true, value };
};
