import type { SendOptions } from '../email';
import { sendViaResend } from '../email';
import { checkerDailyScans, checkerLeadquikUrl, isCheckerGraderConfigured, type Env } from '../env';
import { json, methodNotAllowed, readJson, retryAfterSeconds } from '../http';
import {
  CHECKER_REPORT_IP,
  CHECKER_SCAN_DAY_LIMIT,
  CHECKER_SCAN_IP,
  CHECKER_SIGNUP_IP,
  checkerDailyRule,
  checkerReportIpName,
  checkerScanDayIpName,
  checkerScanIpName,
  checkerSignupIpName,
  globalCheckerScanName,
  hitLimiter,
  orLimiterDown,
  secondsToEtMidnight,
  untilMidnightRule,
  viaLimiter,
} from '../limits';
import type { HitResult } from '../limiter';
import { isRecord } from '../util';
import { buildReportEmail } from './email';
import { isNotReady, notReady, passesTurnstile } from './gate';
import { GRADER_TIMEOUT_MS, PLAN_STORE_TIMEOUT_MS, callGrader, replyStatus, stripDetails, unavailableBody } from './grader';
import { buildFallbackEmail, buildLeadPayload, sendCheckerLead } from './lead';
import { generatePlan, type PlanDeps } from './plan';
import {
  BODY_MAX_BYTES,
  CHECKER_MESSAGES,
  REPORT_TOKEN,
  isGated,
  requestCountry,
  validateScan,
  validateUnlock,
} from './validate';

/** Seams for tests (a stubbed model client, no retry delays). Production uses `{}`. */
export interface CheckerDeps {
  plan?: PlanDeps;
  email?: SendOptions;
}

const rateLimited = (resetAt: number): Response =>
  json({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': retryAfterSeconds(resetAt) });

/** The limiter is down: without it there are no limits, so the route stops taking requests. */
const unavailable = (): Response => json({ ok: false, error: 'unavailable' }, 503);

const verificationFailed = (): Response => json({ ok: false, error: 'verification_failed' }, 403);

const validationFailed = (fields: Record<string, string>): Response =>
  json({ ok: false, error: 'validation', fields }, 400);

// Reasons the grader gives are its own short constants, but the log line only ever carries a clean one.
const logReason = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[a-z_]{1,32}$/.test(value) ? value : undefined;

// --- POST /checker/scan ------------------------------------------------------------------

const fakeScan = (gated: boolean): Record<string, unknown> => ({
  ok: true,
  scan_id: crypto.randomUUID(),
  host: 'example.com',
  final_url: 'https://example.com/',
  cached: false,
  checked_at: new Date().toISOString(),
  read_limited: false,
  bot_view: false,
  overall: { score: 70, grade: 'C' },
  seo: { score: 70, grade: 'C' },
  conversion: { score: 70, grade: 'C' },
  summary: { to_fix: 3, to_improve: 4, passing: 20, categories: [] },
  gated,
});

const fakeToken = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const handleScan = async (request: Request, env: Env): Promise<Response> => {
  const body = await readJson(request, BODY_MAX_BYTES);
  if (!body.ok) return validationFailed({ url: CHECKER_MESSAGES.urlRequired });
  const validation = validateScan(body.value);
  if (!validation.ok) return validationFailed(validation.fields);
  const scan = validation.value;
  const gated = isGated(request);

  // A bot that fills the hidden field gets a normal-looking answer and nothing is called or counted.
  if (scan.honeypot) return json(fakeScan(gated));
  if (isNotReady(request, env)) return notReady();

  return orLimiterDown(async () => {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const burst = await viaLimiter(hitLimiter(env, await checkerScanIpName(ip, env.RATE_SALT), CHECKER_SCAN_IP));
    if (!burst.allowed) return rateLimited(burst.resetAt);
    const day = await viaLimiter(
      hitLimiter(env, await checkerScanDayIpName(ip, env.RATE_SALT), untilMidnightRule(CHECKER_SCAN_DAY_LIMIT)),
    );
    if (!day.allowed) return rateLimited(day.resetAt);

    if (!(await passesTurnstile(request, env, scan.turnstileToken))) return verificationFailed();

    // The site-wide cap moves only for a scan that is about to run, so a refused visitor never uses it up.
    const cap = checkerDailyScans(env);
    const site: HitResult | null = cap === 0 ? null : await viaLimiter(hitLimiter(env, globalCheckerScanName(), checkerDailyRule(cap)));
    if (site === null || !site.allowed) {
      return json({ ok: false, error: 'capacity' }, 503, { 'Retry-After': String(secondsToEtMidnight()) });
    }

    const result = await callGrader(env, { action: 'scan', url: scan.url, profile: scan.profile, force: scan.force });
    if (result.kind === 'unavailable') {
      console.error(JSON.stringify({ event: 'checker_scan', ok: false, status: result.status }));
      return json(unavailableBody, 502);
    }
    const reason = logReason(result.body.reason);
    console.log(JSON.stringify({ event: 'checker_scan', ok: result.body.ok === true, status: result.status, ...(reason ? { reason } : {}) }));
    // Pass the grader's answer on as it is, minus anything that belongs to the breakdown, plus `gated`.
    const clean = stripDetails(result.body) as Record<string, unknown>;
    return json({ ...clean, gated }, replyStatus(result.status));
  }, unavailable);
};

// --- POST /checker/unlock ----------------------------------------------------------------

const handleUnlock = async (request: Request, env: Env, deps: CheckerDeps | undefined): Promise<Response> => {
  const body = await readJson(request, BODY_MAX_BYTES);
  if (!body.ok) return validationFailed({ scanId: CHECKER_MESSAGES.scanInvalid });
  const gated = isGated(request);
  const validation = validateUnlock(body.value, gated);
  if (!validation.ok) return validationFailed(validation.fields);
  const visitor = validation.value;

  if (visitor.honeypot) {
    return json({ ok: true, report_token: fakeToken(), report: null, plan: null, emailed: false });
  }
  if (isNotReady(request, env)) return notReady();

  return orLimiterDown(async () => {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const signup = await viaLimiter(hitLimiter(env, await checkerSignupIpName(ip, env.RATE_SALT), CHECKER_SIGNUP_IP));
    if (!signup.allowed) return rateLimited(signup.resetAt);
    if (!(await passesTurnstile(request, env, visitor.turnstileToken))) return verificationFailed();

    // 1. Ask the grader for the breakdown (and let it record the competitors).
    const unlocked = await callGrader(env, {
      action: 'unlock',
      scan_id: visitor.scanId,
      competitors: visitor.competitors,
    });
    if (unlocked.kind === 'unavailable') return json(unavailableBody, 502);
    const { report, report_token: token } = unlocked.body;
    if (unlocked.body.ok !== true) {
      return json(unlocked.body, replyStatus(unlocked.status));
    }
    if (typeof token !== 'string' || token.length === 0 || !isRecord(report)) {
      console.error(JSON.stringify({ event: 'checker_grader_error', action: 'unlock', status: unlocked.status, reason: 'bad_shape' }));
      return json(unavailableBody, 502);
    }

    // 2. The written plan. It never blocks the report.
    const planOutcome = await generatePlan(env, report, visitor.industry, deps?.plan).catch(() => {
      console.error(JSON.stringify({ event: 'checker_plan_failed', reason: 'unexpected' }));
      return { plan: null } as const;
    });
    const plan = planOutcome.plan;

    // 3. Store the plan, send the lead (gated visitors only) and the email, side by side. None of them can fail the answer.
    const country = requestCountry(request);
    const store = async (): Promise<void> => {
      if (!plan) return;
      const stored = await callGrader(
        env,
        { action: 'unlock', scan_id: visitor.scanId, competitors: visitor.competitors, plan },
        PLAN_STORE_TIMEOUT_MS,
      );
      if (stored.kind !== 'reply' || stored.body.ok !== true) {
        console.error(JSON.stringify({ event: 'checker_plan_store_failed', status: stored.status }));
      }
    };

    const lead = async (): Promise<void> => {
      if (!gated || visitor.email === undefined || visitor.phone === undefined) return;
      const payload = buildLeadPayload({
        report,
        token,
        name: visitor.name,
        email: visitor.email,
        phone: visitor.phone,
        okToCall: visitor.okToCall,
        industry: visitor.industry,
        city: visitor.city,
        country,
      });
      const result = await sendCheckerLead(payload, checkerLeadquikUrl(env)).catch((): 'failed' => 'failed');
      if (result === 'ok') {
        console.log(JSON.stringify({ event: 'checker_lead', delivery: 'leadquik' }));
        return;
      }
      console.error(JSON.stringify({ event: 'checker_lead_undelivered', result }));
      const saved = await sendViaResend(env, buildFallbackEmail(payload), deps?.email).catch(() => false);
      console.log(JSON.stringify({ event: saved ? 'checker_lead_fallback_sent' : 'checker_lead_fallback_failed' }));
    };

    const email = async (): Promise<boolean> => {
      if (visitor.email === undefined) return false;
      const sent = await sendViaResend(env, buildReportEmail(visitor.email, report, token, plan), deps?.email).catch(() => false);
      if (!sent) console.error(JSON.stringify({ event: 'checker_email_failed' }));
      return sent;
    };

    const [, , emailed] = await Promise.all([
      store().catch(() => console.error(JSON.stringify({ event: 'checker_plan_store_failed', status: 0 }))),
      lead().catch(() => console.error(JSON.stringify({ event: 'checker_lead_failed', reason: 'unexpected' }))),
      email().catch(() => false),
    ]);

    console.log(JSON.stringify({ event: 'checker_unlock', gated, plan: plan !== null, emailed: emailed === true }));
    return json({ ok: true, report_token: token, report, plan, emailed: emailed === true });
  }, unavailable);
};

// --- GET /checker/report -----------------------------------------------------------------

const handleReport = async (request: Request, env: Env): Promise<Response> => {
  if (!isCheckerGraderConfigured(env)) return notReady();
  const token = new URL(request.url).searchParams.get('r') ?? '';
  return orLimiterDown(async () => {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const hit = await viaLimiter(hitLimiter(env, await checkerReportIpName(ip, env.RATE_SALT), CHECKER_REPORT_IP));
    if (!hit.allowed) return rateLimited(hit.resetAt);
    if (!REPORT_TOKEN.test(token)) return json({ ok: false, reason: 'not_found' }, 404);

    const result = await callGrader(env, { action: 'report', report_token: token }, GRADER_TIMEOUT_MS);
    if (result.kind === 'unavailable') return json(unavailableBody, 502);
    console.log(JSON.stringify({ event: 'checker_report', ok: result.body.ok === true, status: result.status }));
    return json(result.body, replyStatus(result.status));
  }, unavailable);
};

// --- routing -----------------------------------------------------------------------------

export const handleChecker = (request: Request, env: Env, pathname: string, deps: CheckerDeps | undefined): Promise<Response> | Response => {
  switch (pathname) {
    case '/checker/scan':
      return request.method === 'POST' ? handleScan(request, env) : methodNotAllowed('POST, OPTIONS');
    case '/checker/unlock':
      return request.method === 'POST' ? handleUnlock(request, env, deps) : methodNotAllowed('POST, OPTIONS');
    case '/checker/report':
      return request.method === 'GET' ? handleReport(request, env) : methodNotAllowed('GET, OPTIONS');
    default:
      return json({ error: 'not_found' }, 404);
  }
};
