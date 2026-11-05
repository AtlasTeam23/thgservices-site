import { clampLength } from '../sanitize';
import { isRecord } from '../util';
import type { LeadEmail } from '../email';
import { escapeHtml, formatPhone } from '../email';

export const REPORT_PAGE = 'https://thgservices.io/website-checker/';
const TIMEOUT_MS = 5000;

/** The link a visitor (and the sales team) opens to see a report. The token is the only secret in it. */
export const reportLink = (token: string): string => `${REPORT_PAGE}?r=${encodeURIComponent(token)}`;

/** A host name cut down to what a host can contain, for a subject line, a note or a link text. */
export const cleanHost = (value: unknown): string =>
  typeof value === 'string' ? clampLength(value.toLowerCase().replace(/[^a-z0-9.-]/g, ''), 100) : '';

interface Grade {
  score: number;
  grade: string;
}

/** A `{score, grade}` pair as the grader sends it, or null (a read-limited report has none for Conversion and Overall). */
export const gradeOf = (value: unknown): Grade | null =>
  isRecord(value) && typeof value.score === 'number' && Number.isFinite(value.score) && typeof value.grade === 'string' && /^[A-F]$/.test(value.grade)
    ? { score: Math.round(value.score), grade: value.grade }
    : null;

const show = (grade: Grade | null): string => (grade ? `${grade.score} ${grade.grade}` : 'n/a');

export const isReadLimited = (report: Record<string, unknown>): boolean =>
  report.read_limited === true || gradeOf(report.conversion) === null;

/** "Overall 71 C. SEO 90 A. Conversion 51 F." or, for a page that needs JavaScript, SEO plus the not-graded line. */
export const gradeSentence = (report: Record<string, unknown>): string => {
  const seo = `SEO ${show(gradeOf(report.seo))}.`;
  if (isReadLimited(report)) return `${seo} Conversion: not graded (page needs JavaScript).`;
  return `Overall ${show(gradeOf(report.overall))}. ${seo} Conversion ${show(gradeOf(report.conversion))}.`;
};

export interface LeadInput {
  report: Record<string, unknown>;
  token: string;
  name: string;
  email: string;
  phone: string;
  okToCall: boolean;
  industry: string;
  city: string;
  country: string | null;
}

/** Competitor hosts the report names, if the grader included them (`competitors: [{host}]`). */
const competitorHosts = (report: Record<string, unknown>): string[] =>
  Array.isArray(report.competitors)
    ? report.competitors.map((entry) => cleanHost(isRecord(entry) ? entry.host : entry)).filter((host) => host !== '')
    : [];

export const buildNotes = (input: LeadInput): string => {
  const hosts = competitorHosts(input.report);
  return [
    `Website check: ${cleanHost(input.report.host)}`,
    gradeSentence(input.report),
    `Report: ${reportLink(input.token)}`,
    `Industry: ${input.industry}`,
    input.city ? `City: ${input.city}` : '',
    hosts.length > 0 ? `Competitors: ${hosts.join(', ')}` : '',
    `OK to call or text: ${input.okToCall ? 'yes' : 'no'}`,
    `Visitor country: ${input.country ?? 'XX'}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
};

/** The lead intake body. `sms_consent` is never sent: the checkbox answer lives in the notes only. */
export interface CheckerLeadPayload {
  name: string;
  email: string;
  phone: string;
  service_needed: 'Free website check';
  notes: string;
}

export const buildLeadPayload = (input: LeadInput): CheckerLeadPayload => ({
  name: input.name,
  email: input.email,
  phone: input.phone,
  service_needed: 'Free website check',
  notes: buildNotes(input),
});

export type CheckerLeadResult = 'ok' | 'failed' | 'skipped';

const isAllowedUrl = (url: URL): boolean =>
  url.protocol === 'https:' ||
  (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));

/**
 * Posts the lead to the secret intake URL: 5 seconds, no retry. The URL is the credential, so it is
 * never logged; a failure logs a status or a reason only.
 */
export const sendCheckerLead = async (
  payload: CheckerLeadPayload,
  url: string | undefined,
  timeoutMs: number = TIMEOUT_MS,
): Promise<CheckerLeadResult> => {
  if (!url) return 'skipped';
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    console.error(JSON.stringify({ event: 'checker_lead_failed', reason: 'invalid_url' }));
    return 'failed';
  }
  if (!isAllowedUrl(target)) {
    console.error(JSON.stringify({ event: 'checker_lead_failed', reason: 'url_not_https' }));
    return 'failed';
  }
  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel();
    if (response.ok) return 'ok';
    console.error(JSON.stringify({ event: 'checker_lead_failed', status: response.status }));
    return 'failed';
  } catch (error) {
    console.error(JSON.stringify({ event: 'checker_lead_failed', status: 0, reason: (error as Error)?.name ?? 'Error' }));
    return 'failed';
  }
};

/** The note emailed to LEAD_TO_EMAIL when the lead could not be delivered, so the sign-up is not lost. */
export const buildFallbackEmail = (payload: CheckerLeadPayload): LeadEmail => {
  const lines = [
    'A website checker sign-up could not be delivered to the CRM. Here it is so it is not lost.',
    '',
    `Name: ${payload.name}`,
    `Phone: ${formatPhone(payload.phone)}`,
    `Email: ${payload.email}`,
    `Service needed: ${payload.service_needed}`,
    '',
    payload.notes,
    '',
  ];
  return {
    subject: clampLength(`Website check sign-up (CRM delivery failed): ${payload.name}`, 200),
    text: lines.join('\n'),
    html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#0f172a;background:#ffffff"><pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(lines.join('\n'))}</pre></div>`,
    replyTo: payload.email,
  };
};
