import { WINDOW_LABELS } from './copy';
import { resendApiKey, type Env } from './env';
import { clampLength, singleLine } from './sanitize';
import { sleep } from './util';
import type { LeadPayload } from './validation';

export interface LeadEmail {
  subject: string;
  text: string;
  html: string;
  /** The visitor's address, when they gave one, so "Reply" in the inbox reaches them. */
  replyTo?: string;
}

// --- time formatting (everything in the email is Eastern time) ----------------------

// Newer ICU versions put U+202F (narrow no-break space) before AM/PM. It is invisible
// and awkward to copy, so the email uses a plain space.
const NBSP_VARIANTS = new RegExp(`[${String.fromCharCode(0x202f, 0xa0)}]`, 'g');

const stampFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  dateStyle: 'medium',
  timeStyle: 'short',
});
const clockFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeStyle: 'short' });

const tidy = (formatted: string): string => formatted.replace(NBSP_VARIANTS, ' ');

/** "Nov 3, 2026, 4:05 PM ET" */
export const formatStamp = (date: Date): string => `${tidy(stampFormat.format(date))} ET`;

/** "4:05 PM", or "--:--" when the client sent no usable timestamp. */
const formatClock = (iso: string): string => {
  const date = new Date(iso);
  return iso && !Number.isNaN(date.getTime()) ? tidy(clockFormat.format(date)) : '--:--';
};

export const formatPhone = (digits: string): string => {
  const match = /^(\d{3})(\d{3})(\d{4})$/.exec(digits);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : digits;
};

// --- builders -----------------------------------------------------------------------

const NOT_PROVIDED = '(not provided)';
const LABEL_WIDTH = 17;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const speaker = (role: 'user' | 'assistant'): string => (role === 'user' ? 'You' : 'THG helper');

// The page URL is attacker-controlled text, so it only becomes a clickable link when it is on
// one of our own origins. Comparing the parsed origin (not a prefix) defeats tricks like
// https://thgservices.io@evil.example/ and https://thgservices.io.evil.example/.
const LINKABLE_ORIGINS: ReadonlySet<string> = new Set(['https://thgservices.io', 'https://www.thgservices.io']);

const isOwnSiteUrl = (value: string): boolean => {
  try {
    return LINKABLE_ORIGINS.has(new URL(value).origin);
  } catch {
    return false;
  }
};

export const buildLeadEmail = (lead: LeadPayload, now: Date = new Date()): LeadEmail => {
  const name = singleLine(lead.name);
  const business = singleLine(lead.business);
  const phone = formatPhone(lead.phone);
  const email = lead.email ?? NOT_PROVIDED;
  const need = lead.need.trim() || NOT_PROVIDED;
  const windowLabel = WINDOW_LABELS[lead.callbackWindow];
  const pageUrl = lead.page.url || NOT_PROVIDED;
  const utm = Object.entries(lead.page.utm);
  const stamp = formatStamp(now);

  const subject = clampLength(`New website lead: ${business} — ${name}`, 200);

  const row = (label: string, value: string): string => `${`${label}:`.padEnd(LABEL_WIDTH)}${value}`;
  const transcriptLines = lead.transcript.map(
    (entry) => `[${formatClock(entry.at)}] ${speaker(entry.role)}: ${entry.content}`,
  );

  const text = [
    'New lead from the thgservices.io AI Website Concierge',
    '',
    row('Name', name),
    row('Phone', phone),
    row('Email', email),
    row('Business', business),
    row('Callback window', windowLabel),
    row('Need', need),
    '',
    row('Page', pageUrl),
    utm.length === 0
      ? row('UTM', '(none)')
      : utm.map(([key, value], i) => (i === 0 ? row('UTM', `${key}: ${value}`) : `${' '.repeat(LABEL_WIDTH)}${key}: ${value}`)).join('\n'),
    row('Submitted', stamp),
    row('Consent', 'Yes. OK to contact by phone, text, or email about this request.'),
    '',
    '--- Chat transcript ---',
    ...(transcriptLines.length > 0 ? transcriptLines : ['(no chat before the form)']),
    '',
  ].join('\n');

  const cell = (label: string, valueHtml: string): string =>
    `<tr><th align="left" valign="top" style="padding:4px 16px 4px 0;color:#475569;font-weight:600;white-space:nowrap">${escapeHtml(label)}</th><td style="padding:4px 0">${valueHtml}</td></tr>`;
  const plain = (value: string): string => escapeHtml(value);
  const link = isOwnSiteUrl(pageUrl)
    ? `<a href="${escapeHtml(pageUrl)}">${escapeHtml(pageUrl)}</a>`
    : plain(pageUrl);
  const utmHtml = utm.length === 0 ? '(none)' : utm.map(([key, value]) => `${plain(key)}: ${plain(value)}`).join('<br>');
  const transcriptHtml =
    transcriptLines.length > 0
      ? transcriptLines.map((line) => `<div style="padding:2px 0">${plain(line)}</div>`).join('')
      : '<div>(no chat before the form)</div>';

  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">',
    '<h2 style="margin:0 0 12px;font-size:18px">New lead from the thgservices.io AI Website Concierge</h2>',
    '<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse">',
    cell('Name', plain(name)),
    cell('Phone', plain(phone)),
    cell('Email', lead.email ? `<a href="mailto:${escapeHtml(lead.email)}">${plain(lead.email)}</a>` : plain(NOT_PROVIDED)),
    cell('Business', plain(business)),
    cell('Callback window', plain(windowLabel)),
    cell('Need', plain(need).replace(/\n/g, '<br>')),
    cell('Page', link),
    cell('UTM', utmHtml),
    cell('Submitted', plain(stamp)),
    cell('Consent', 'Yes. OK to contact by phone, text, or email about this request.'),
    '</table>',
    '<h3 style="margin:20px 0 8px;font-size:15px">Chat transcript</h3>',
    `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#334155">${transcriptHtml}</div>`,
    '</div>',
  ].join('');

  return { subject, text, html, ...(lead.email ? { replyTo: lead.email } : {}) };
};

// --- Resend -------------------------------------------------------------------------

const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 8000;
const DEFAULT_RETRY_DELAY_MS = 500;

export interface SendOptions {
  retryDelayMs?: number;
  /** Per-attempt timeout; overridable so tests do not wait 8 seconds. */
  timeoutMs?: number;
}


/**
 * Sends the lead email through Resend. One retry, only for failures a retry can fix
 * (network errors, timeouts, 429, 5xx); the same Idempotency-Key is reused so a retry
 * after a lost response cannot produce a duplicate email. Returns true when Resend
 * accepted the message. Never logs the key or any lead details.
 */
export const sendViaResend = async (env: Env, email: LeadEmail, options: SendOptions = {}): Promise<boolean> => {
  const apiKey = resendApiKey(env);
  if (!apiKey) return false;

  const body = JSON.stringify({
    from: env.LEAD_FROM_EMAIL,
    to: [env.LEAD_TO_EMAIL],
    subject: email.subject,
    text: email.text,
    html: email.html,
    ...(email.replyTo ? { reply_to: email.replyTo } : {}),
  });
  const idempotencyKey = crypto.randomUUID();

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let retryable = true;
    try {
      const response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? RESEND_TIMEOUT_MS),
      });
      if (response.ok) return true;
      await response.body?.cancel();
      retryable = response.status === 429 || response.status >= 500;
      console.error(JSON.stringify({ event: 'resend_error', status: response.status, attempt }));
    } catch (error) {
      console.error(JSON.stringify({ event: 'resend_error', status: 0, attempt, error: (error as Error)?.name ?? 'Error' }));
    }
    if (!retryable || attempt === 2) return false;
    await sleep(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  }
  return false;
};
