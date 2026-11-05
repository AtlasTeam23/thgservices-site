// Network layer for the checker. Like the chat's, no function here throws:
// every outcome is a typed result the page can switch on. Hosts, names, emails
// and tokens are sent to the Worker only, never to analytics.

import { apiBase } from '../../components/concierge/config';
import { getToken } from '../../components/concierge/turnstile';
import { SCAN_TIMEOUT_MS, UNLOCK_TIMEOUT_MS } from './config';
import type {
  FailReason,
  Profile,
  Report,
  ScanOk,
  UnlockFields,
} from './types';

const FAIL_REASONS: readonly FailReason[] = [
  'blocked',
  'no_response',
  'not_found',
  'site_error',
  'timeout',
  'not_html',
  'too_large',
  'invalid_url',
  'recheck_too_soon',
];

type Failure =
  | { kind: 'rate_limited' }
  | { kind: 'daily_cap' }
  | { kind: 'not_ready' }
  | { kind: 'verify' }
  | { kind: 'timeout' }
  | { kind: 'network' };

export type ScanOutcome =
  | { kind: 'ok'; data: ScanOk }
  | { kind: 'fail'; reason: FailReason; host: string | null }
  | Failure;

export type UnlockOutcome =
  | { kind: 'ok'; reportToken: string; report: Report; emailed: boolean }
  | { kind: 'fields'; fields: UnlockFields }
  | Failure;

export type ReportOutcome =
  | { kind: 'ok'; report: Report }
  | { kind: 'not_found' }
  | Failure;

type Raw = { status: number; body: Record<string, unknown> } | 'timeout' | 'network';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

async function send(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  timeoutMs: number
): Promise<Raw> {
  const base = apiBase();
  if (!base) return { status: 503, body: { error: 'checker_not_ready' } };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return { status: res.status, body: isObject(parsed) ? parsed : {} };
  } catch (err) {
    const aborted = controller.signal.aborted || (err as { name?: string })?.name === 'AbortError';
    return aborted ? 'timeout' : 'network';
  } finally {
    clearTimeout(timer);
  }
}

function failureFrom(raw: Raw): Failure | null {
  if (raw === 'timeout') return { kind: 'timeout' };
  if (raw === 'network') return { kind: 'network' };
  const err = typeof raw.body.error === 'string' ? raw.body.error : '';
  if (raw.status === 429 || err === 'rate_limited') {
    return err === 'daily_cap' ? { kind: 'daily_cap' } : { kind: 'rate_limited' };
  }
  if (err === 'daily_cap') return { kind: 'daily_cap' };
  if (err === 'checker_not_ready' || raw.status === 503) return { kind: 'not_ready' };
  if (/verif|turnstile/i.test(err)) return { kind: 'verify' };
  return null;
}

export type ScanRequest = { url: string; profile: Profile; force?: boolean };

export async function scanSite(req: ScanRequest, honeypot = ''): Promise<ScanOutcome> {
  const turnstileToken = await getToken().catch(() => null);
  const raw = await send(
    'POST',
    '/checker/scan',
    {
      url: req.url,
      profile: req.profile,
      ...(req.force ? { force: true } : {}),
      ...(turnstileToken ? { turnstileToken } : {}),
      company_website: honeypot,
    },
    SCAN_TIMEOUT_MS
  );
  const failure = failureFrom(raw);
  if (failure) return failure;
  if (typeof raw === 'string') return { kind: 'network' };
  const b = raw.body;
  if (b.ok === true && typeof b.scan_id === 'string' && isObject(b.seo) && isObject(b.summary)) {
    return { kind: 'ok', data: b as unknown as ScanOk };
  }
  if (b.ok === false) {
    const reason = FAIL_REASONS.find((r) => r === b.reason);
    if (reason) {
      return { kind: 'fail', reason, host: typeof b.host === 'string' ? b.host : null };
    }
  }
  return { kind: 'network' };
}

export type UnlockRequest = {
  scanId: string;
  industry: Profile;
  city?: string;
  competitors?: string[];
  name?: string;
  email?: string;
  phone?: string;
  okToCall?: boolean;
};

export async function unlockReport(req: UnlockRequest, honeypot = ''): Promise<UnlockOutcome> {
  const turnstileToken = await getToken().catch(() => null);
  const body: Record<string, unknown> = { scanId: req.scanId, industry: req.industry };
  if (req.city) body.city = req.city;
  if (req.competitors && req.competitors.length > 0) body.competitors = req.competitors;
  if (req.name !== undefined) body.name = req.name;
  if (req.email !== undefined) body.email = req.email;
  if (req.phone !== undefined) body.phone = req.phone;
  if (req.okToCall !== undefined) body.okToCall = req.okToCall;
  if (turnstileToken) body.turnstileToken = turnstileToken;
  body.company_website = honeypot;

  const raw = await send('POST', '/checker/unlock', body, UNLOCK_TIMEOUT_MS);
  const failure = failureFrom(raw);
  if (failure) return failure;
  if (typeof raw === 'string') return { kind: 'network' };
  const b = raw.body;
  if (raw.status === 400 && b.ok === false && isObject(b.fields)) {
    return { kind: 'fields', fields: b.fields };
  }
  if (b.ok === true && typeof b.report_token === 'string' && isObject(b.report)) {
    const report = b.report as unknown as Report;
    // The plan may arrive beside the report or inside it.
    if (isObject(b.plan) && !report.plan) report.plan = b.plan as unknown as Report['plan'];
    return { kind: 'ok', reportToken: b.report_token, report, emailed: b.emailed === true };
  }
  return { kind: 'network' };
}

export async function fetchReport(token: string): Promise<ReportOutcome> {
  const raw = await send('GET', `/checker/report?r=${encodeURIComponent(token)}`, undefined, UNLOCK_TIMEOUT_MS);
  if (typeof raw !== 'string' && raw.status === 404) return { kind: 'not_found' };
  const failure = failureFrom(raw);
  if (failure) return failure;
  if (typeof raw === 'string') return { kind: 'network' };
  if (raw.body.ok === true && isObject(raw.body.report)) {
    return { kind: 'ok', report: raw.body.report as unknown as Report };
  }
  return { kind: 'network' };
}

export type { Failure };
