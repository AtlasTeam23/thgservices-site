import type { SendOptions } from '../email';
import { sendViaResend } from '../email';
import { checkerDailyScans, checkerLeadquikUrl, isCheckerGraderConfigured, isEmailConfigured, type Env } from '../env';
import { json, methodNotAllowed, readJson, retryAfterSeconds } from '../http';
import {
  CHECKER_EMAIL_HOURLY,
  CHECKER_REPORT_IP,
  CHECKER_SCAN_DAY_LIMIT,
  CHECKER_SCAN_IP,
  CHECKER_SIGNUP_IP,
  checkerDailyRule,
  checkerEmailName,
  checkerReportIpName,
  checkerScanDayIpName,
  checkerScanIpName,
  checkerSignupIpName,
  checkerUnlockEmailName,
  checkerUnlockName,
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
import { GRADER_TIMEOUT_MS, PLAN_STORE_TIMEOUT_MS, callGrader, cleanReason, replyStatus, shapeFailure, shapeScan, unavailableBody } from './grader';
import { buildFallbackEmail, buildLeadPayload, sendCheckerLead } from './lead';
import { generatePlan, type ActionPlan, type PlanDeps } from './plan';
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
    const reason = cleanReason(result.body.reason);
    console.log(JSON.stringify({ event: 'checker_scan', ok: result.body.ok === true, status: result.status, ...(reason ? { reason } : {}) }));
    // Rebuilt from an allow-list of known fields, plus `gated`: nothing else the grader sends gets through.
    return json({ ...shapeScan(result.body), gated }, replyStatus(result.status));
  }, unavailable);
};

// --- POST /checker/unlock ----------------------------------------------------------------

/** The stored plan in a report the grader returns for a repeat unlock, if it has a well-formed one. */
const storedPlan = (report: Record<string, unknown>): ActionPlan | null => {
  const plan = report.plan;
  if (!isRecord(plan) || typeof plan.summary !== 'string' || !Array.isArray(plan.items)) return null;
  const items = plan.items
    .filter(isRecord)
    .filter((item) => typeof item.check_id === 'string' && typeof item.text === 'string')
    .map((item) => ({ check_id: item.check_id as string, text: item.text as string }));
  return { summary: plan.summary, items };
};

const handleUnlock = async (request: Request, env: Env, ctx: ExecutionContext, deps: CheckerDeps | undefined): Promise<Response> => {
  const body = await readJson(request, BODY_MAX_BYTES);
  if (!body.ok) return validationFailed({ scanId: CHECKER_MESSAGES.scanInvalid });
  const gated = isGated(request);
  const validation = validateUnlock(body.value, gated);
  if (!validation.ok) return validationFailed(validation.fields);
  const visitor = validation.value;
  const unlockedAt = new Date().toISOString();

  if (visitor.honeypot) {
    return json({ ok: true, report_token: fakeToken(), report: null, plan: null, emailed: false });
  }
  if (isNotReady(request, env)) return notReady();

  return orLimiterDown(async () => {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const signup = await viaLimiter(hitLimiter(env, await checkerSignupIpName(ip, env.RATE_SALT), CHECKER_SIGNUP_IP));
    if (!signup.allowed) return rateLimited(signup.resetAt);
    // A real unlock mails the address it was given, so one address gets only a few an hour, from anywhere.
    if (visitor.email !== undefined) {
      const mail = await viaLimiter(hitLimiter(env, await checkerEmailName(visitor.email, env.RATE_SALT), CHECKER_EMAIL_HOURLY));
      if (!mail.allowed) return rateLimited(mail.resetAt);
    }
    if (!(await passesTurnstile(request, env, visitor.turnstileToken))) return verificationFailed();

    // 1. Ask the grader for the breakdown (and let it record the competitors). Repeating this is harmless.
    const unlocked = await callGrader(env, {
      action: 'unlock',
      scan_id: visitor.scanId,
      competitors: visitor.competitors,
    });
    if (unlocked.kind === 'unavailable') return json(unavailableBody, 502);
    if (unlocked.body.ok !== true) return json(shapeFailure(unlocked.body), replyStatus(unlocked.status));
    const { report, report_token: token } = unlocked.body;
    if (typeof token !== 'string' || token.length === 0 || !isRecord(report)) {
      console.error(JSON.stringify({ event: 'checker_grader_error', action: 'unlock', status: unlocked.status, reason: 'bad_shape' }));
      return json(unavailableBody, 502);
    }

    // 2. Only the first unlock of a scan each Eastern day lets the lead and the plan happen. A repeat gets the
    // stored report back with no lead and no model call. The page's "Email me a copy" is such a repeat (the
    // same scan with just an email), so one report email per scan and address per day is still allowed.
    const emailRule = untilMidnightRule(1);
    const mayEmail =
      visitor.email === undefined
        ? false
        : (await viaLimiter(hitLimiter(env, await checkerUnlockEmailName(visitor.scanId, visitor.email, env.RATE_SALT), emailRule))).allowed;
    const first = await viaLimiter(hitLimiter(env, checkerUnlockName(visitor.scanId), untilMidnightRule(1)));
    if (!first.allowed) {
      const saved = storedPlan(report);
      const sendCopy = mayEmail && isEmailConfigured(env);
      console.log(JSON.stringify({ event: 'checker_unlock_repeat', emailed: sendCopy }));
      if (sendCopy) {
        ctx.waitUntil(
          sendViaResend(env, buildReportEmail(visitor.email!, report, token, saved), deps?.email)
            .then((sent) => {
              if (!sent) console.error(JSON.stringify({ event: 'checker_email_failed' }));
            })
            .catch(() => console.error(JSON.stringify({ event: 'checker_email_failed' }))),
        );
      }
      return json({ ok: true, report_token: token, report, plan: saved, emailed: sendCopy });
    }

    // 3. The written plan. It never blocks the report.
    const planOutcome = await generatePlan(env, report, visitor.industry, deps?.plan).catch(() => {
      console.error(JSON.stringify({ event: 'checker_plan_failed', reason: 'unexpected' }));
      return { plan: null } as const;
    });
    const plan = planOutcome.plan;

    // 4. Answer now. Storing the plan, the lead (gated visitors only) and the email finish in the background, and
    // none of them can change the answer. `emailed` means an email will be sent.
    const country = requestCountry(request);
    const willEmail = visitor.email !== undefined && isEmailConfigured(env);

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
        consentText: visitor.consentText,
        consentAt: unlockedAt,
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

    ctx.waitUntil(
      Promise.all([
        store().catch(() => console.error(JSON.stringify({ event: 'checker_plan_store_failed', status: 0 }))),
        lead().catch(() => console.error(JSON.stringify({ event: 'checker_lead_failed', reason: 'unexpected' }))),
        email().catch(() => false),
      ])
        .then(([, , sent]) => console.log(JSON.stringify({ event: 'checker_unlock', gated, plan: plan !== null, emailed: sent === true })))
        .catch(() => undefined),
    );

    return json({ ok: true, report_token: token, report, plan, emailed: willEmail });
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
    // The visitor's own saved report passes through; a failure is rebuilt from known fields.
    return json(result.body.ok === true ? result.body : shapeFailure(result.body), replyStatus(result.status));
  }, unavailable);
};

// --- routing -----------------------------------------------------------------------------

export const handleChecker = (request: Request, env: Env, ctx: ExecutionContext, pathname: string, deps: CheckerDeps | undefined): Promise<Response> | Response => {
  switch (pathname) {
    case '/checker/scan':
      return request.method === 'POST' ? handleScan(request, env) : methodNotAllowed('POST, OPTIONS');
    case '/checker/unlock':
      return request.method === 'POST' ? handleUnlock(request, env, ctx, deps) : methodNotAllowed('POST, OPTIONS');
    case '/checker/report':
      return request.method === 'GET' ? handleReport(request, env) : methodNotAllowed('GET, OPTIONS');
    default:
      return json({ error: 'not_found' }, 404);
  }
};
