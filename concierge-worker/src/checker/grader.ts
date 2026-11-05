import { siteCheckerSecret, siteCheckerUrl, type Env } from '../env';
import { isRecord } from '../util';

export const GRADER_TIMEOUT_MS = 30_000;
export const PLAN_STORE_TIMEOUT_MS = 10_000;

export type GraderAction = 'scan' | 'unlock' | 'report';

export type GraderResult =
  /** The grader answered with JSON. `status` is its HTTP status. */
  | { kind: 'reply'; status: number; body: Record<string, unknown> }
  /** No answer, or one that was not a JSON object: timeout, network error, 5xx, junk. */
  | { kind: 'unavailable'; status: number };

const isAllowedUrl = (url: URL): boolean =>
  url.protocol === 'https:' ||
  (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));

/**
 * Calls the grader function with the shared secret. The URL and secret are credentials: neither is
 * ever logged, and a failure logs only the action, a status code and a reason. The caller decides
 * what the visitor sees.
 */
export const callGrader = async (
  env: Env,
  payload: { action: GraderAction } & Record<string, unknown>,
  timeoutMs: number = GRADER_TIMEOUT_MS,
): Promise<GraderResult> => {
  const url = siteCheckerUrl(env);
  const secret = siteCheckerSecret(env);
  if (!url || !secret) return { kind: 'unavailable', status: 0 };

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    console.error(JSON.stringify({ event: 'checker_grader_error', action: payload.action, status: 0, reason: 'invalid_url' }));
    return { kind: 'unavailable', status: 0 };
  }
  if (!isAllowedUrl(target)) {
    console.error(JSON.stringify({ event: 'checker_grader_error', action: payload.action, status: 0, reason: 'url_not_https' }));
    return { kind: 'unavailable', status: 0 };
  }

  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-checker-secret': secret },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    if (response.status >= 500 || !isRecord(body)) {
      console.error(JSON.stringify({ event: 'checker_grader_error', action: payload.action, status: response.status, reason: response.status >= 500 ? 'upstream' : 'bad_body' }));
      return { kind: 'unavailable', status: response.status };
    }
    return { kind: 'reply', status: response.status, body };
  } catch (error) {
    console.error(JSON.stringify({ event: 'checker_grader_error', action: payload.action, status: 0, reason: (error as Error)?.name ?? 'Error' }));
    return { kind: 'unavailable', status: 0 };
  }
};

/** What the visitor sees when the grader cannot be reached. */
export const unavailableBody = { ok: false, reason: 'unavailable' } as const;

// Keys that belong to the paid breakdown. A scan answer must never carry them, whatever the grader
// sends: the grades are free and the details are behind the form.
const DETAIL_KEYS: ReadonlySet<string> = new Set([
  'report',
  'report_token',
  'checks',
  'sections',
  'top_fixes',
  'finding',
  'fix',
  'plan',
  'competitors',
]);

/** Copies `value` without any detail key, at any depth. */
export const stripDetails = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripDetails);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (!DETAIL_KEYS.has(key)) out[key] = stripDetails(inner);
    }
    return out;
  }
  return value;
};

/** The HTTP status to give the visitor for a grader reply: its own 2xx/4xx, never a 5xx. */
export const replyStatus = (status: number): number => (status >= 200 && status < 500 ? status : 502);
