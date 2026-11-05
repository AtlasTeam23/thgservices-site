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

// What a visitor may be shown before the sign-up is built from known fields only. Anything the grader adds,
// renames or nests (details, breakdown, items, a differently cased Report) is not on the list and never leaves.

const num = (value: unknown, max = 1_000_000): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : undefined;
const count = (value: unknown): number | undefined => (Number.isInteger(value) ? num(value) : undefined);
const str = (value: unknown, pattern: RegExp, max: number): string | undefined =>
  typeof value === 'string' && value.length <= max && pattern.test(value) ? value : undefined;
const flag = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

/** A short lower-case reason code such as "blocked" or "recheck_too_soon", or undefined. */
export const cleanReason = (value: unknown): string | undefined => str(value, /^[a-z_]{1,32}$/, 32);

const gradeField = (value: unknown): { score: number; grade: string } | null | undefined => {
  if (value === null) return null; // a page that needs JavaScript has no Conversion or Overall grade
  if (!isRecord(value)) return undefined;
  const score = num(value.score, 100);
  const grade = str(value.grade, /^[A-F]$/, 1);
  return score === undefined || grade === undefined ? undefined : { score, grade };
};

const definedOnly = (entries: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined));

const categoryField = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined;
  const id = str(value.id, /^[A-Za-z0-9._-]{1,64}$/, 64);
  if (id === undefined) return undefined;
  return definedOnly({
    id,
    section: str(value.section, /^[a-z_]{1,32}$/, 32),
    label: str(value.label, /^[^<>]{1,200}$/, 200),
    to_fix: count(value.to_fix),
    to_improve: count(value.to_improve),
    passing: count(value.passing),
  });
};

const summaryField = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined;
  return definedOnly({
    to_fix: count(value.to_fix),
    to_improve: count(value.to_improve),
    passing: count(value.passing),
    categories: Array.isArray(value.categories)
      ? value.categories.slice(0, 40).map(categoryField).filter((c): c is Record<string, unknown> => c !== undefined)
      : undefined,
  });
};

/**
 * The free scan answer, rebuilt from an allow-list: ok, scan_id, host, final_url, cached, checked_at,
 * read_limited, bot_view, overall, seo, conversion (each `{score, grade}`, or null for Overall and Conversion),
 * summary `{to_fix, to_improve, passing, categories[{id, section, label, to_fix, to_improve, passing}]}`,
 * reason and http_status. Each value is checked for type and size too.
 */
export const shapeScan = (body: Record<string, unknown>): Record<string, unknown> =>
  definedOnly({
    ok: body.ok === true,
    scan_id: str(body.scan_id, /^[A-Za-z0-9-]{8,64}$/, 64),
    host: str(body.host, /^[A-Za-z0-9.-]{1,253}$/, 253),
    final_url: str(body.final_url, /^https?:\/\/[^\s<>"']{1,2040}$/, 2048),
    cached: flag(body.cached),
    checked_at: str(body.checked_at, /^[0-9TZ:.+-]{10,40}$/, 40),
    read_limited: flag(body.read_limited),
    bot_view: flag(body.bot_view),
    overall: gradeField(body.overall),
    seo: gradeField(body.seo),
    conversion: gradeField(body.conversion),
    summary: summaryField(body.summary),
    reason: cleanReason(body.reason),
    http_status: Number.isInteger(body.http_status) ? num(body.http_status, 999) : undefined,
  });

/** A failed unlock or report answer: `{ok: false, reason?, fields?}` and nothing else. */
export const shapeFailure = (body: Record<string, unknown>): Record<string, unknown> => {
  const fields = isRecord(body.fields)
    ? Object.fromEntries(
        Object.entries(body.fields)
          .slice(0, 20)
          .filter(([key, value]) => /^[A-Za-z_]{1,32}$/.test(key) && typeof value === 'string')
          .map(([key, value]) => [key, (value as string).replace(/[<>]/g, '').slice(0, 200)]),
      )
    : undefined;
  return definedOnly({ ok: false, reason: cleanReason(body.reason), fields: fields && Object.keys(fields).length > 0 ? fields : undefined });
};

/** The HTTP status to give the visitor for a grader reply: its own 2xx/4xx, never a 5xx. */
export const replyStatus = (status: number): number => (status >= 200 && status < 500 ? status : 502);
