import { reset } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/index';
import type { PlanClient, PlanParams } from '../src/checker/plan';
import { REPLY_JSON_SCHEMA } from '../src/llm';
import { globalCheckerPlanName, hitLimiter } from '../src/limits';
import {
  CHECKER_REPORT_IP,
  CHECKER_SCAN_DAY_LIMIT,
  checkerReportIpName,
  checkerScanDayIpName,
  untilMidnightRule,
} from '../src/limits';
import { call, captureLogs, fixedCount, randomIp, randomUuid, testEnv } from './helpers';

const GRADER_URL = 'https://grader.test/functions/check';
const GRADER_SECRET = 'grader-shared-secret-placeholder';
const LEAD_URL = 'https://leads.test/hook?token=lead-token-placeholder';
const TOKEN = 'tok_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc';
const CONSENT = 'By tapping Show my breakdown you agree that THG AI Services may call you, including with an automated AI assistant, and text or email you about your website results. You can opt out at any time.';
const TURNSTILE_SECRET = '1x0000000000000000000000000000000AA';

const HOST = 'client-site.example';
const RIVAL = 'rival-one.example';

const report = (over: Record<string, unknown> = {}) => ({
  host: HOST,
  final_url: `https://www.${HOST}/`,
  checked_at: '2026-11-05T15:00:00Z',
  read_limited: false,
  bot_view: false,
  overall: { score: 71, grade: 'C' },
  seo: { score: 90, grade: 'A' },
  conversion: { score: 51, grade: 'F' },
  top_fixes: [
    { check_id: 'conversion.call_to_action', title: 'Clear call to action', fix: 'Add a button that says how to get in touch.' },
    { check_id: 'seo.title_tag', title: 'Page title', fix: "Aim for 30-60 characters so it doesn't truncate in search results." },
  ],
  sections: [
    {
      id: 'seo',
      title: 'SEO',
      subtitle: 'How easy you are to find in search.',
      categories: [
        {
          id: 'seo.idx',
          label: 'Getting listed',
          checks: [
            { id: 'seo.title_tag', title: 'Page title', status: 'warn', points: 5, max_points: 10, finding: '<code>Home</code> (4 chars)', fix: 'Aim for 30-60 characters.' },
          ],
        },
      ],
    },
    {
      id: 'conversion',
      title: 'Conversion',
      subtitle: 'How well the page turns visitors into calls.',
      categories: [
        {
          id: 'conversion.cta',
          label: 'Calls to action',
          checks: [
            { id: 'conversion.call_to_action', title: 'Clear call to action', status: 'fail', points: 0, max_points: 10, finding: 'No clear call to action found.', fix: 'Add a button.' },
          ],
        },
      ],
    },
  ],
  competitors: [{ host: RIVAL }],
  ...over,
});

const limitedReport = () =>
  report({ read_limited: true, overall: null, conversion: null, top_fixes: [{ check_id: 'seo.title_tag', title: 'Page title', fix: 'Aim for 30-60 characters.' }] });

const scanOk = (extra: Record<string, unknown> = {}) => ({
  ok: true,
  scan_id: randomUuid(),
  host: HOST,
  final_url: `https://www.${HOST}/`,
  cached: false,
  checked_at: '2026-11-05T15:00:00Z',
  read_limited: false,
  bot_view: false,
  overall: { score: 71, grade: 'C' },
  seo: { score: 90, grade: 'A' },
  conversion: { score: 51, grade: 'F' },
  summary: { to_fix: 5, to_improve: 6, passing: 20, categories: [{ id: 'seo.idx', section: 'seo', label: 'Getting listed', to_fix: 1, to_improve: 0, passing: 4 }] },
  ...extra,
});

type Outcome = number | Error;
interface GraderReply {
  status?: number;
  body: unknown;
}
interface Routes {
  grader?: (payload: Record<string, any>) => GraderReply | Error;
  lead?: Outcome;
  resend?: Outcome;
  siteverify?: boolean;
}

const defaultGrader = (payload: Record<string, any>): GraderReply => {
  if (payload.action === 'scan') return { body: scanOk() };
  if (payload.action === 'unlock') return { body: { ok: true, report_token: TOKEN, report: report() } };
  return { body: { ok: true, report: report() } };
};

/** Stubs global fetch and routes by host. The model is never reached over the network: tests pass a client stub. */
const stubNetwork = (routes: Routes = {}) => {
  const calls: Array<{ host: string; url: string; init: RequestInit | undefined; json: any }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const host = new URL(url).host;
    let json: any;
    try {
      json = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    } catch {
      json = undefined;
    }
    calls.push({ host, url, init, json });
    if (host === 'grader.test') {
      const reply = (routes.grader ?? defaultGrader)(json);
      if (reply instanceof Error) throw reply;
      return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
    }
    if (host === 'leads.test') {
      const outcome = routes.lead ?? 200;
      if (outcome instanceof Error) throw outcome;
      return new Response('{}', { status: outcome });
    }
    if (host === 'api.resend.com') {
      const outcome = routes.resend ?? 200;
      if (outcome instanceof Error) throw outcome;
      return new Response('{"id":"stub"}', { status: outcome });
    }
    if (host === 'challenges.cloudflare.com') {
      return new Response(JSON.stringify({ success: routes.siteverify ?? true }), { status: 200 });
    }
    throw new Error(`unexpected network call to ${host}`);
  });
  const to = (host: string) => calls.filter((c) => c.host === host);
  return {
    calls,
    grader: () => to('grader.test'),
    graderActions: () => to('grader.test').map((c) => c.json?.action),
    lead: () => to('leads.test'),
    resend: () => to('api.resend.com'),
    siteverify: () => to('challenges.cloudflare.com'),
  };
};

const PLAN_JSON = JSON.stringify({
  summary: 'Start with your call to action, then fix the page title.',
  items: [
    { check_id: 'conversion.call_to_action', text: 'Add a clear button near the top of the page so visitors know how to reach you.' },
    { check_id: 'seo.title_tag', text: 'Rewrite the page title so it reads well in search results.' },
  ],
});

const planClient = (reply: string | Error = PLAN_JSON, stop_reason = 'end_turn') => {
  const create = vi.fn(async (_params: PlanParams) => {
    if (reply instanceof Error) throw reply;
    return { stop_reason, content: [{ type: 'text', text: reply }], usage: { input_tokens: 400, output_tokens: 200 } };
  });
  return { client: { messages: { create } } satisfies PlanClient, create };
};

const appWith = (plan?: PlanClient) => createApp({ checker: { plan: plan ? { client: plan } : {}, email: { retryDelayMs: 0 } } });

const checkerEnv = (extra: Record<string, unknown> = {}) =>
  testEnv({
    SITE_CHECKER_URL: GRADER_URL,
    SITE_CHECKER_SECRET: GRADER_SECRET,
    CHECKER_LEADQUIK_URL: LEAD_URL,
    CHECKER_REQUIRE_TURNSTILE: 'false',
    RESEND_API_KEY: 'placeholder-not-a-real-key',
    LLM_PROVIDER: 'anthropic',
    LLM_API_KEY: 'placeholder-not-a-real-key',
    ...extra,
  });

const scan = (body: Record<string, unknown> = {}, options: Parameters<typeof call>[1] = {}) =>
  call('/checker/scan', { body: { url: 'client-site.example', profile: 'trade', ...body }, env: checkerEnv(), app: appWith(), ...options });

const gatedBody = (extra: Record<string, unknown> = {}) => ({
  scanId: randomUuid(),
  industry: 'Home services',
  name: 'Jane Doe',
  email: 'jane@example.com',
  phone: '(770) 555-1234',
  okToCall: true,
  consentText: CONSENT,
  ...extra,
});

const unlock = (body: Record<string, unknown>, options: Parameters<typeof call>[1] = {}) =>
  call('/checker/unlock', { body, env: checkerEnv(), app: appWith(planClient().client), country: 'US', ...options });

beforeEach(async () => {
  await reset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('POST /checker/scan', () => {
  it('calls the grader with the secret header and the cleaned body, and adds gated', async () => {
    const net = stubNetwork();
    const res = await scan({ force: true }, { country: 'US' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://thgservices.io');
    const body = (await res.json()) as Record<string, any>;
    expect(body).toMatchObject({ ok: true, host: HOST, overall: { score: 71, grade: 'C' }, gated: true });
    expect(body.summary.categories).toHaveLength(1);

    expect(net.grader()).toHaveLength(1);
    const sent = net.grader()[0]!;
    expect(sent.url).toBe(GRADER_URL);
    expect(new Headers(sent.init!.headers).get('x-checker-secret')).toBe(GRADER_SECRET);
    expect(sent.json).toEqual({ action: 'scan', url: 'client-site.example', profile: 'trade', force: true });
    expect(sent.init!.signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts the six profiles and turns anything else into general', async () => {
    const net = stubNetwork();
    for (const profile of ['trade', 'professional', 'health', 'retail', 'software', 'general']) {
      await scan({ profile });
    }
    await scan({ profile: 'plumber' });
    await scan({ profile: 7 });
    await scan({ profile: undefined });
    expect(net.grader().map((c) => c.json.profile)).toEqual(['trade', 'professional', 'health', 'retail', 'software', 'general', 'general', 'general', 'general']);
    expect(net.grader().every((c) => c.json.force === false)).toBe(true);
  });

  it('never passes breakdown fields through, even if the grader sends them', async () => {
    stubNetwork({
      grader: () => ({
        body: scanOk({
          report: report(),
          report_token: TOKEN,
          checks: [{ finding: 'x', fix: 'y' }],
          top_fixes: [{ fix: 'y' }],
          sections: [{ checks: [] }],
          plan: { summary: 's' },
          summary: { to_fix: 1, to_improve: 0, passing: 2, categories: [{ id: 'seo.idx', finding: 'leak', fix: 'leak', to_fix: 1 }] },
        }),
      }),
    });
    const res = await scan();
    const text = await res.text();
    for (const key of ['report', 'report_token', 'checks', 'finding', 'fix', 'sections', 'top_fixes', 'plan']) {
      expect(text).not.toContain(`"${key}"`);
    }
    expect(JSON.parse(text)).toMatchObject({ ok: true, gated: true, summary: { to_fix: 1, categories: [{ id: 'seo.idx', to_fix: 1 }] } });
  });

  it('builds the answer from an allow-list: renamed, nested and differently cased detail keys do not survive', async () => {
    stubNetwork({
      grader: () => ({
        body: scanOk({
          details: 'LEAKVALUE-details',
          breakdown: [{ title: 'LEAKVALUE-breakdown' }],
          items: [{ text: 'LEAKVALUE-items' }],
          Report: { host: 'LEAKVALUE-Report' },
          REPORT_TOKEN: 'LEAKVALUE-token',
          checks_by_category: { seo: ['LEAKVALUE-cbc'] },
          reason: 'blocked<script>',
          overall: { score: 71, grade: 'C', explanation: 'LEAKVALUE-grade' },
          seo: { score: 90, grade: 'A', checks: ['LEAKVALUE-seo'] },
          summary: {
            to_fix: 5,
            to_improve: 6,
            passing: 20,
            details: 'LEAKVALUE-summary',
            categories: [{ id: 'seo.idx', section: 'seo', label: 'Getting listed', to_fix: 1, to_improve: 0, passing: 4, Checks: ['LEAKVALUE-cat'], items: ['LEAKVALUE-cat2'] }],
          },
        }),
      }),
    });
    const text = await (await scan()).text();
    expect(text).not.toContain('LEAKVALUE');
    for (const key of ['details', 'breakdown', 'items', 'Report', 'REPORT_TOKEN', 'checks_by_category', 'Checks', 'explanation', 'checks', 'reason']) {
      expect(text).not.toContain(`"${key}"`);
    }
    const body = JSON.parse(text);
    expect(Object.keys(body).sort()).toEqual(['bot_view', 'cached', 'checked_at', 'conversion', 'final_url', 'gated', 'host', 'ok', 'overall', 'read_limited', 'scan_id', 'seo', 'summary']);
    expect(Object.keys(body.summary).sort()).toEqual(['categories', 'passing', 'to_fix', 'to_improve']);
    expect(body.overall).toEqual({ score: 71, grade: 'C' });
    expect(Object.keys(body.summary.categories[0]).sort()).toEqual(['id', 'label', 'passing', 'section', 'to_fix', 'to_improve']);
  });

  it('keeps a validated reason and http_status on a failure and nothing else', async () => {
    stubNetwork({ grader: () => ({ body: { ok: false, host: HOST, reason: 'blocked', http_status: 403, message: 'LEAKVALUE', details: { a: 1 } } }) });
    const text = await (await scan()).text();
    expect(JSON.parse(text)).toEqual({ ok: false, host: HOST, reason: 'blocked', http_status: 403, gated: true });
  });

  it('passes a failure reason on with gated, and the grader status', async () => {
    stubNetwork({ grader: () => ({ status: 200, body: { ok: false, host: HOST, reason: 'blocked', http_status: 403 } }) });
    const res = await scan();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, host: HOST, reason: 'blocked', http_status: 403, gated: true });
  });

  it('answers 502 unavailable when the grader fails, times out, or returns junk', async () => {
    for (const routes of [
      { grader: () => ({ status: 500, body: { ok: false } }) },
      { grader: () => new DOMException('The operation was aborted', 'TimeoutError') as unknown as Error },
      { grader: () => ({ body: 'not json' }) },
    ]) {
      stubNetwork(routes);
      const res = await scan();
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ ok: false, reason: 'unavailable' });
      vi.restoreAllMocks();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
    }
  });

  it('rejects a missing address with the field message and a non-POST with 405', async () => {
    const net = stubNetwork();
    const res = await scan({ url: '   ' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'validation', fields: { url: 'Enter your website address' } });
    expect((await call('/checker/scan', { method: 'GET', env: checkerEnv() })).status).toBe(405);
    expect(net.grader()).toHaveLength(0);
  });
});

describe('gated comes from the request country', () => {
  it.each([
    ['US', true],
    [undefined, true],
    ['XX', true],
    ['T1', true],
    ['CA', false],
    ['GB', false],
  ])('country %s gives gated %s', async (country, gated) => {
    stubNetwork();
    const res = await scan({}, { country });
    expect(((await res.json()) as { gated: boolean }).gated).toBe(gated);
  });
});

describe('honeypot', () => {
  it('answers a normal-looking scan and calls nothing when company_website is filled', async () => {
    const net = stubNetwork();
    const res = await scan({ company_website: 'https://spam.example' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, gated: true, overall: { grade: 'C' } });
    expect(net.calls).toHaveLength(0);
  });

  it('answers a normal-looking unlock and calls nothing', async () => {
    const net = stubNetwork();
    const res = await unlock({ company_website: 'x' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, emailed: false });
    expect(net.calls).toHaveLength(0);
  });
});

describe('limits', () => {
  it('allows 10 scans per 10 minutes per address, then answers 429 with Retry-After', async () => {
    stubNetwork();
    const ip = randomIp();
    for (let i = 0; i < 10; i += 1) expect((await scan({}, { ip })).status).toBe(200);
    const res = await scan({}, { ip });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: 'rate_limited' });
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await scan({}, { ip: randomIp() })).status).toBe(200); // another address is untouched
  });

  it('allows 30 scans per Eastern day per address', async () => {
    const net = stubNetwork();
    const ip = randomIp();
    const env = checkerEnv();
    const name = await checkerScanDayIpName(ip, env.RATE_SALT);
    for (let i = 0; i < CHECKER_SCAN_DAY_LIMIT; i += 1) await hitLimiter(env, name, untilMidnightRule(CHECKER_SCAN_DAY_LIMIT));
    const res = await scan({}, { ip, env });
    expect(res.status).toBe(429);
    expect(net.grader()).toHaveLength(0);
  });

  it('allows 5 sign-ups per hour per address', async () => {
    stubNetwork();
    const ip = randomIp();
    for (let i = 0; i < 5; i += 1) expect((await unlock({ scanId: randomUuid(), industry: 'Retail' }, { ip, country: 'CA' })).status).toBe(200);
    const res = await unlock({ scanId: randomUuid(), industry: 'Retail' }, { ip, country: 'CA' });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('does not count an invalid sign-up against the allowance', async () => {
    stubNetwork();
    const ip = randomIp();
    for (let i = 0; i < 6; i += 1) expect((await unlock({ scanId: 'nope' }, { ip })).status).toBe(400);
    expect((await unlock(gatedBody(), { ip })).status).toBe(200);
  });

  it('allows 60 report reads per 10 minutes per address', async () => {
    const net = stubNetwork();
    const ip = randomIp();
    const env = checkerEnv();
    const name = await checkerReportIpName(ip, env.RATE_SALT);
    for (let i = 0; i < 60; i += 1) await hitLimiter(env, name, CHECKER_REPORT_IP);
    const res = await call(`/checker/report?r=${TOKEN}`, { ip, env, app: appWith() });
    expect(res.status).toBe(429);
    expect(net.grader()).toHaveLength(0);
  });

  it('stops scans for everyone at CHECKER_DAILY_SCANS and says so with 503 capacity', async () => {
    const net = stubNetwork();
    const env = checkerEnv({ CHECKER_DAILY_SCANS: '2' });
    expect((await scan({}, { env })).status).toBe(200);
    expect((await scan({}, { env })).status).toBe(200);
    const res = await scan({}, { env });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: 'capacity' });
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(net.grader()).toHaveLength(2);
  });

  it('refuses every scan when CHECKER_DAILY_SCANS is 0', async () => {
    stubNetwork();
    expect((await scan({}, { env: checkerEnv({ CHECKER_DAILY_SCANS: '0' }) })).status).toBe(503);
  });
});

describe('the Turnstile launch gate', () => {
  it('answers 503 checker_not_ready when Turnstile is required, no secret exists and the page is not local', async () => {
    const net = stubNetwork();
    for (const required of [undefined, 'true', 'yes']) {
      const env = checkerEnv({ CHECKER_REQUIRE_TURNSTILE: required });
      const res = await scan({}, { env });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: 'checker_not_ready' });
      expect((await unlock(gatedBody(), { env })).status).toBe(503);
    }
    // no Origin at all (curl) is not local either
    expect((await scan({}, { env: checkerEnv({ CHECKER_REQUIRE_TURNSTILE: undefined }), origin: null })).status).toBe(503);
    expect(net.calls).toHaveLength(0);
  });

  it('runs on honeypot and limits alone when the var is "false"', async () => {
    const net = stubNetwork();
    expect((await scan()).status).toBe(200);
    expect(net.siteverify()).toHaveLength(0);
  });

  it('lets the Worker through while required and unconfigured only when it is itself reached on localhost', async () => {
    stubNetwork();
    const env = checkerEnv({ CHECKER_REQUIRE_TURNSTILE: 'true' });
    expect((await scan({}, { env, baseUrl: 'http://localhost:8787' })).status).toBe(200);
    expect((await scan({}, { env, baseUrl: 'http://127.0.0.1:8787' })).status).toBe(200);
    expect((await unlock(gatedBody(), { env, baseUrl: 'http://localhost:8787' })).status).toBe(200);
  });

  it('is not fooled by an Origin header that says localhost (an allowed origin anyone can send)', async () => {
    const net = stubNetwork();
    const env = checkerEnv({ CHECKER_REQUIRE_TURNSTILE: 'true' });
    for (const origin of ['http://localhost:3000', 'http://localhost:4173']) {
      const res = await scan({}, { env, origin });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: 'checker_not_ready' });
      expect((await unlock(gatedBody(), { env, origin })).status).toBe(503);
    }
    expect(net.calls).toHaveLength(0);
  });

  it('with the secret set and the gate on, refuses a missing token and accepts a good one', async () => {
    const net = stubNetwork();
    const env = checkerEnv({ CHECKER_REQUIRE_TURNSTILE: 'true', TURNSTILE_SECRET_KEY: TURNSTILE_SECRET });
    const refused = await scan({}, { env });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ ok: false, error: 'verification_failed' });
    expect(net.grader()).toHaveLength(0);

    const ok = await scan({ turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' }, { env });
    expect(ok.status).toBe(200);
    expect(net.siteverify()).toHaveLength(1);
  });

  it('with the gate off, verifies a token only when one is sent', async () => {
    const net = stubNetwork({ siteverify: false });
    const env = checkerEnv({ TURNSTILE_SECRET_KEY: TURNSTILE_SECRET });
    expect((await scan({}, { env })).status).toBe(200); // no token, nothing to verify
    expect((await scan({ turnstileToken: 'bad-token' }, { env })).status).toBe(403);
    expect(net.siteverify()).toHaveLength(1);
  });

  it('answers 503 checker_not_ready when the grader secrets are missing', async () => {
    stubNetwork();
    expect((await scan({}, { env: checkerEnv({ SITE_CHECKER_SECRET: undefined }) })).status).toBe(503);
    expect((await scan({}, { env: checkerEnv({ SITE_CHECKER_URL: undefined }) })).status).toBe(503);
    expect((await call(`/checker/report?r=${TOKEN}`, { env: checkerEnv({ SITE_CHECKER_URL: undefined }) })).status).toBe(503);
  });
});

describe('POST /checker/unlock validation', () => {
  it('requires name, email and a 10-digit phone when gated, with the /lead messages', async () => {
    const net = stubNetwork();
    const res = await unlock({ scanId: randomUuid(), industry: 'Retail' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'validation',
      fields: { name: 'Please enter your name', phone: 'Enter a 10-digit US phone number', email: 'Enter a valid email address' },
    });
    const bad = await unlock(gatedBody({ email: 'nope', phone: '555' }));
    expect(((await bad.json()) as { fields: Record<string, string> }).fields).toEqual({ phone: 'Enter a 10-digit US phone number', email: 'Enter a valid email address' });
    expect(net.calls).toHaveLength(0);
  });

  it('never trusts a gated flag in the body', async () => {
    stubNetwork();
    const res = await unlock({ scanId: randomUuid(), industry: 'Retail', gated: false });
    expect(res.status).toBe(400); // a US visitor is gated whatever the body says
    const open = await unlock({ scanId: randomUuid(), industry: 'Retail', gated: true }, { country: 'CA' });
    expect(open.status).toBe(200); // a visitor outside the US is not
  });

  it('requires a scan id, an industry, and at most three competitor scan ids', async () => {
    stubNetwork();
    expect(((await (await unlock(gatedBody({ scanId: 'x' }))).json()) as any).fields.scanId).toBeTruthy();
    expect(((await (await unlock(gatedBody({ industry: '' }))).json()) as any).fields.industry).toBe('Choose your industry');
    const four = Array.from({ length: 4 }, randomUuid);
    expect(((await (await unlock(gatedBody({ competitors: four }))).json()) as any).fields.competitors).toBeTruthy();
    expect(((await (await unlock(gatedBody({ competitors: ['not-an-id'] }))).json()) as any).fields.competitors).toBeTruthy();
  });

  it('needs no contact fields outside the US, and creates no lead and no email', async () => {
    const net = stubNetwork();
    const res = await unlock({ scanId: randomUuid(), industry: 'Retail' }, { country: 'CA' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, report_token: TOKEN, emailed: false });
    expect(net.lead()).toHaveLength(0);
    expect(net.resend()).toHaveLength(0);
  });

  it('emails an ungated visitor who gave an address, and still creates no lead', async () => {
    const net = stubNetwork();
    const res = await unlock({ scanId: randomUuid(), industry: 'Retail', email: 'visitor@example.com', name: 'Ignored', phone: '7705551234' }, { country: 'GB' });
    expect(await res.json()).toMatchObject({ ok: true, emailed: true });
    expect(net.lead()).toHaveLength(0);
    expect(net.resend()).toHaveLength(1);
    expect(net.resend()[0]!.json.to).toEqual(['visitor@example.com']);
  });

  it('refuses a bad address typed by an ungated visitor', async () => {
    stubNetwork();
    const res = await unlock({ scanId: randomUuid(), industry: 'Retail', email: 'nope' }, { country: 'CA' });
    expect(res.status).toBe(400);
  });
});

describe('POST /checker/unlock for a gated visitor', () => {
  it('returns the token, report and plan, stores the plan, sends the lead and one email', async () => {
    const net = stubNetwork();
    const plan = planClient();
    const scanId = randomUuid();
    const rival = randomUuid();
    const res = await unlock(gatedBody({ scanId, competitors: [rival, rival], city: 'Woodstock' }), { app: appWith(plan.client) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(Object.keys(body).sort()).toEqual(['emailed', 'ok', 'plan', 'report', 'report_token']);
    expect(body.ok).toBe(true);
    expect(body.report_token).toBe(TOKEN);
    expect(body.report.host).toBe(HOST);
    expect(body.emailed).toBe(true);
    expect(body.plan.summary).toBe('Start with your call to action, then fix the page title.');
    expect(body.plan.items.map((i: any) => i.check_id)).toEqual(['conversion.call_to_action', 'seo.title_tag']);

    // The grader: unlock without a plan first, then again with it.
    expect(net.graderActions()).toEqual(['unlock', 'unlock']);
    expect(net.grader()[0]!.json).toEqual({ action: 'unlock', scan_id: scanId, competitors: [rival] });
    expect(net.grader()[1]!.json).toEqual({ action: 'unlock', scan_id: scanId, competitors: [rival], plan: body.plan });
    for (const c of net.grader()) expect(new Headers(c.init!.headers).get('x-checker-secret')).toBe(GRADER_SECRET);

    // The model saw the top fixes and the industry, not page HTML.
    expect(plan.create).toHaveBeenCalledTimes(1);
    const params = plan.create.mock.calls[0]![0];
    expect(params.max_tokens).toBe(700);
    expect(params.messages[0]!.content).toContain('<industry>Home services</industry>');
    expect(params.messages[0]!.content).toContain('check_id: conversion.call_to_action');
    expect(params.messages[0]!.content).toContain('found: Home (4 chars)');
    expect(params.messages[0]!.content).not.toContain('<code>');
    expect(params.messages[0]!.content).not.toContain(RIVAL);

    // The lead: exactly this shape, never sms_consent.
    expect(net.lead()).toHaveLength(1);
    expect(net.lead()[0]!.url).toBe(LEAD_URL);
    const lead = net.lead()[0]!.json;
    expect(Object.keys(lead).sort()).toEqual(['consent_at', 'consent_text', 'email', 'name', 'notes', 'phone', 'service_needed']);
    expect(lead).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '7705551234',
      service_needed: 'Free website check',
      consent_text: CONSENT,
      consent_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      notes: [
        `Website check: ${HOST}`,
        'Overall 71 C. SEO 90 A. Conversion 51 F.',
        `Report: https://thgservices.io/website-checker/?r=${TOKEN}`,
        'Industry: Home services',
        'City: Woodstock',
        `Competitors: ${RIVAL}`,
        'Consent to call, text or email: yes (given at submit)',
        'Visitor country: US',
      ].join('\n'),
    });
    expect(JSON.stringify(lead)).not.toContain('sms_consent');

    // The one email, to the visitor.
    expect(net.resend()).toHaveLength(1);
    const mail = net.resend()[0]!.json;
    expect(mail.to).toEqual(['jane@example.com']);
    expect(mail.from).toBe('THG AI Services <concierge@leadquik.com>');
    expect(mail.subject).toBe(`Your website report for ${HOST}`);
    expect(mail.text).toContain('Overall: C (71)');
    expect(mail.text).toContain('SEO: A (90)');
    expect(mail.text).toContain('Conversion: F (51)');
    expect(mail.text).toContain('1. Clear call to action');
    expect(mail.text).toContain('Start with your call to action, then fix the page title.');
    expect(mail.text).toContain(`https://thgservices.io/website-checker/?r=${TOKEN}`);
    expect(mail.html).toContain(`href="https://thgservices.io/website-checker/?r=${TOKEN}"`);
    expect(mail.html).toContain('bgcolor="#ffffff"');
    expect(mail.html).not.toMatch(/gradient|background-image/i);
  });

  it('sends consent_text and consent_at with the lead, and the sentence is sanitized and kept to 400 characters', async () => {
    const net = stubNetwork();
    await unlock(gatedBody({ consentText: `<b>${CONSENT}</b>\n  extra   words` }));
    const lead = net.lead()[0]!.json;
    expect(lead.consent_text).toBe(`${CONSENT} extra words`);
    expect(lead.consent_at).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(String(lead.consent_at)))).toBe(false);
  });

  it('omits consent_text and consent_at when the page sent no sentence (an older page), and still sends the lead', async () => {
    const net = stubNetwork();
    const res = await unlock(gatedBody({ consentText: undefined }));
    expect(res.status).toBe(200);
    expect(net.lead()).toHaveLength(1);
    const lead = net.lead()[0]!.json;
    expect(lead).not.toHaveProperty('consent_text');
    expect(lead).not.toHaveProperty('consent_at');
    expect(String(lead.notes)).toContain('Consent to call, text or email: yes (given at submit)');
  });

  it('drops a consent sentence over 400 characters rather than cutting it short', async () => {
    const net = stubNetwork();
    await unlock(gatedBody({ consentText: 'x'.repeat(401) }));
    expect(net.lead()[0]!.json).not.toHaveProperty('consent_text');
    expect(net.lead()).toHaveLength(1);
  });

  it('records consent: no and a missing city, and an unknown country as XX', async () => {
    const net = stubNetwork();
    await unlock(gatedBody({ okToCall: false }), { country: undefined });
    const notes = String(net.lead()[0]!.json.notes);
    expect(notes).toContain('Consent to call, text or email: no');
    expect(notes).toContain('Visitor country: XX');
    expect(notes).not.toContain('City:');
  });

  it('leaves Conversion and Overall out of the lead and the email for a page that needs JavaScript', async () => {
    const net = stubNetwork({ grader: (p) => (p.action === 'unlock' ? { body: { ok: true, report_token: TOKEN, report: limitedReport() } } : defaultGrader(p)) });
    await unlock(gatedBody());
    const notes = String(net.lead()[0]!.json.notes);
    expect(notes).toContain('SEO 90 A. Conversion: not graded (page needs JavaScript).');
    expect(notes).not.toContain('Overall');
    const mail = net.resend()[0]!.json;
    expect(mail.text).toContain('SEO: A (90)');
    expect(mail.text).not.toContain('Overall');
    expect(mail.text).not.toContain('Conversion: F');
    expect(mail.html).not.toContain('Overall');
  });

  it('delivers the lead through the LEAD_TO_EMAIL fallback when the lead fails, and still answers 200', async () => {
    for (const lead of [500, new Error('network down')]) {
      const net = stubNetwork({ lead });
      const res = await unlock(gatedBody());
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, emailed: true });
      const recipients = net.resend().map((c) => c.json.to);
      expect(recipients).toContainEqual(['jane@example.com']);
      expect(recipients).toContainEqual(['developer@leadquik.com']);
      const fallback = net.resend().find((c) => c.json.to[0] === 'developer@leadquik.com')!.json;
      expect(fallback.text).toContain('Jane Doe');
      expect(fallback.text).toContain('(770) 555-1234');
      expect(fallback.text).toContain('jane@example.com');
      expect(fallback.text).toContain('Free website check');
      expect(fallback.text).toContain(`?r=${TOKEN}`);
      vi.restoreAllMocks();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
    }
  });

  it('uses the fallback when no lead URL is configured', async () => {
    const net = stubNetwork();
    const res = await unlock(gatedBody(), { env: checkerEnv({ CHECKER_LEADQUIK_URL: undefined }) });
    expect(res.status).toBe(200);
    expect(net.lead()).toHaveLength(0);
    expect(net.resend().map((c) => c.json.to[0])).toContain('developer@leadquik.com');
  });

  it('still returns the report with no plan when the model fails, and logs checker_plan_failed', async () => {
    const logs = captureLogs();
    const net = stubNetwork();
    const res = await unlock(gatedBody(), { app: appWith(planClient(new Error('boom')).client) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.plan).toBeNull();
    expect(body.report.host).toBe(HOST);
    expect(body.emailed).toBe(true);
    expect(net.graderActions()).toEqual(['unlock']); // nothing to store
    expect(logs.filter((l) => l.includes('checker_plan_failed'))).toHaveLength(1);
    expect(net.lead()).toHaveLength(1);
  });

  it.each([
    ['not JSON', 'this is not json'],
    ['the wrong shape', JSON.stringify({ summary: 'x' })],
    ['an invented number', JSON.stringify({ summary: 'Start here.', items: [{ check_id: 'seo.title_tag', text: 'Do this and gain 45% more visitors.' }] })],
    ['only unknown checks', JSON.stringify({ summary: 'Start here.', items: [{ check_id: 'made.up', text: 'Do something.' }] })],
  ])('drops a plan that is %s', async (_label, reply) => {
    stubNetwork();
    const res = await unlock(gatedBody(), { app: appWith(planClient(reply).client) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).plan).toBeNull();
  });

  it('drops a plan cut off by max_tokens or a refusal', async () => {
    stubNetwork();
    for (const stop of ['max_tokens', 'refusal']) {
      const res = await unlock(gatedBody(), { app: appWith(planClient(PLAN_JSON, stop).client) });
      expect(((await res.json()) as any).plan).toBeNull();
    }
  });

  it('strips markup and emoji from the plan and caps it at 4,000 characters', async () => {
    stubNetwork();
    const long = 'Make this clear. '.repeat(60);
    const reply = JSON.stringify({
      summary: 'Start <b>here</b> \u{1F680}.',
      items: [
        { check_id: 'conversion.call_to_action', text: `<script>x</script>${long}` },
        { check_id: 'seo.title_tag', text: long },
      ],
    });
    const res = await unlock(gatedBody(), { app: appWith(planClient(reply).client) });
    const plan = ((await res.json()) as any).plan;
    expect(plan.summary).toBe('Start here.');
    const total = plan.summary.length + plan.items.reduce((n: number, i: any) => n + i.text.length, 0);
    expect(total).toBeLessThanOrEqual(4000);
    expect(JSON.stringify(plan)).not.toMatch(/<|\u{1F680}/u);
  });

  it('counts the plan against DAILY_LLM_CAP and skips it when the cap is 0', async () => {
    stubNetwork();
    const plan = planClient();
    const res = await unlock(gatedBody(), { env: checkerEnv({ DAILY_LLM_CAP: '0' }), app: appWith(plan.client) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).plan).toBeNull();
    expect(plan.create).not.toHaveBeenCalled();

    const env = checkerEnv({ DAILY_LLM_CAP: '1' });
    const first = await unlock(gatedBody(), { env, app: appWith(plan.client) });
    expect(((await first.json()) as any).plan).not.toBeNull();
    const second = await unlock(gatedBody(), { env, app: appWith(plan.client) });
    expect(((await second.json()) as any).plan).toBeNull();
    expect(plan.create).toHaveBeenCalledTimes(1);
  });

  it('uses the mock provider to write a plan from the report when no model is configured', async () => {
    stubNetwork();
    const env = checkerEnv({ LLM_PROVIDER: 'mock', LLM_API_KEY: undefined });
    const res = await unlock(gatedBody(), { env, app: appWith() });
    const plan = ((await res.json()) as any).plan;
    expect(plan.items).toHaveLength(2);
  });

  it('still answers 200 when the email fails, with emailed false', async () => {
    const net = stubNetwork({ resend: 500 });
    const logs = captureLogs();
    const res = await unlock(gatedBody());
    expect(res.status).toBe(200);
    // `emailed` means an email will be sent; the outcome is logged.
    expect(await res.json()).toMatchObject({ ok: true, emailed: true });
    expect(logs.some((l) => l.includes('checker_email_failed'))).toBe(true);
    expect(net.lead()).toHaveLength(1);
  });

  it('still answers 200 when storing the plan fails', async () => {
    stubNetwork({ grader: (p) => (p.plan ? { status: 200, body: 'junk' } : defaultGrader(p)) });
    const res = await unlock(gatedBody());
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).plan).not.toBeNull();
  });

  it('passes a grader failure on (404 not_found) and sends nothing', async () => {
    const net = stubNetwork({ grader: () => ({ status: 404, body: { ok: false, reason: 'not_found' } }) });
    const res = await unlock(gatedBody());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, reason: 'not_found' });
    expect(net.lead()).toHaveLength(0);
    expect(net.resend()).toHaveLength(0);
  });

  it('answers 502 unavailable when the grader is down and sends nothing', async () => {
    const net = stubNetwork({ grader: () => new Error('down') });
    const res = await unlock(gatedBody());
    expect(res.status).toBe(502);
    expect(net.lead()).toHaveLength(0);
    expect(net.resend()).toHaveLength(0);
  });
});

describe('GET /checker/report', () => {
  it('passes the grader answer on', async () => {
    const net = stubNetwork();
    const res = await call(`/checker/report?r=${TOKEN}`, { env: checkerEnv(), app: appWith() });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ ok: true, report: { host: HOST } });
    expect(net.grader()[0]!.json).toEqual({ action: 'report', report_token: TOKEN });
  });

  it('passes a 404 not_found on and refuses an obviously wrong token without calling the grader', async () => {
    const net = stubNetwork({ grader: () => ({ status: 404, body: { ok: false, reason: 'not_found' } }) });
    const missing = await call(`/checker/report?r=${TOKEN}`, { env: checkerEnv(), app: appWith() });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, reason: 'not_found' });
    expect(net.grader()).toHaveLength(1);

    for (const path of ['/checker/report', '/checker/report?r=', '/checker/report?r=short', '/checker/report?r=%3Cscript%3E']) {
      const res = await call(path, { env: checkerEnv(), app: appWith() });
      expect(res.status).toBe(404);
    }
    expect(net.grader()).toHaveLength(1);
  });

  it('answers 405 to other methods', async () => {
    expect((await call(`/checker/report?r=${TOKEN}`, { method: 'POST', body: {}, env: checkerEnv() })).status).toBe(405);
  });
});

describe('GET /health', () => {
  it('adds checker: true only when all three checker secrets are set', async () => {
    const all = await (await call('/health', { env: checkerEnv() })).json();
    expect(all).toMatchObject({ ok: true, checker: true });
    for (const missing of ['SITE_CHECKER_URL', 'SITE_CHECKER_SECRET', 'CHECKER_LEADQUIK_URL']) {
      const body = await (await call('/health', { env: checkerEnv({ [missing]: undefined }) })).json();
      expect(body).not.toHaveProperty('checker');
    }
    const text = await (await call('/health', { env: checkerEnv() })).text();
    expect(text).not.toContain(GRADER_SECRET);
    expect(text).not.toContain('grader.test');
    expect(text).not.toContain('leads.test');
  });
});

describe('logs', () => {
  it('carry counters only: no hosts, names, emails, tokens, URLs or secrets', async () => {
    const logs = captureLogs();
    stubNetwork({ lead: 500, resend: 500 });
    await scan({ url: 'secret-typed-site.example' });
    await unlock(gatedBody({ competitors: [randomUuid()], city: 'Woodstock' }), { app: appWith(planClient(new Error('boom')).client) });
    await call(`/checker/report?r=${TOKEN}`, { env: checkerEnv(), app: appWith() });
    stubNetwork({ grader: () => new Error('down') });
    await scan();
    await unlock(gatedBody());

    expect(logs.length).toBeGreaterThan(0);
    const joined = logs.join('\n');
    for (const secret of [HOST, RIVAL, 'secret-typed-site', 'Jane', 'jane@example.com', '7705551234', '770', TOKEN, GRADER_SECRET, 'grader.test', LEAD_URL, 'leads.test', 'lead-token', 'Woodstock', 'Home services', 'placeholder-not-a-real-key']) {
      expect(joined, `log line leaked ${secret}`).not.toContain(secret);
    }
    expect(joined).toContain('checker_lead_undelivered');
    expect(joined).toContain('checker_email_failed');
    expect(joined).toContain('checker_plan_failed');
    expect(joined).toContain('checker_grader_error');
  });
});

describe('the model request', () => {
  it('has exactly the same top-level keys as /chat sends', async () => {
    // What /chat sends:
    const chatCreate = vi.fn(async (_params: Record<string, unknown>) => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ reply: 'Hello.', intent: 'answer', offerCallback: false, readyToConfirm: false, lead: { name: '', phone: '', email: '', business: '', need: '', callbackWindow: '' } }) }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const chatApp = createApp({ llm: { client: { messages: { create: chatCreate as never } } } });
    const chatRes = await call('/chat', { body: { sessionId: randomUuid(), messages: [{ role: 'user', content: 'hello' }] }, env: checkerEnv(), app: chatApp });
    expect(chatRes.status).toBe(200);
    const chatKeys = Object.keys(chatCreate.mock.calls[0]![0]).sort();

    // What the checker sends:
    stubNetwork();
    const plan = planClient();
    await unlock(gatedBody(), { app: appWith(plan.client) });
    const params = plan.create.mock.calls[0]![0] as unknown as Record<string, any>;
    expect(Object.keys(params).sort()).toEqual(chatKeys);
    expect(params.output_config.effort).toBe('medium');
    expect(Object.keys(params.output_config).sort()).toEqual(['effort', 'format']);
    expect(params.output_config.format.type).toBe('json_schema');
    expect(REPLY_JSON_SCHEMA).toBeTruthy();
    expect(params.max_tokens).toBe(700);
  });
});

describe('abuse controls while Turnstile is off', () => {
  it('does the real work once per scan per day: a repeat gets the stored report and nothing is sent', async () => {
    const stored = { summary: 'Stored plan.', items: [{ check_id: 'seo.title_tag', text: 'Stored text.' }] };
    let unlocks = 0;
    const net = stubNetwork({
      grader: (p) => {
        if (p.action !== 'unlock') return defaultGrader(p);
        unlocks += 1;
        return { body: { ok: true, report_token: TOKEN, report: unlocks > 2 ? report({ plan: stored }) : report() } };
      },
    });
    const plan = planClient();
    const scanId = randomUuid();
    const first = await unlock(gatedBody({ scanId }), { app: appWith(plan.client) });
    expect(((await first.json()) as any).emailed).toBe(true);
    const sentBefore = { lead: net.lead().length, resend: net.resend().length, plan: plan.create.mock.calls.length };
    expect(sentBefore).toEqual({ lead: 1, resend: 1, plan: 1 });

    const again = await unlock(gatedBody({ scanId }), { app: appWith(plan.client), ip: randomIp() });
    expect(again.status).toBe(200);
    const body = (await again.json()) as any;
    expect(body).toMatchObject({ ok: true, report_token: TOKEN, emailed: false, plan: stored });
    expect(body.report.host).toBe(HOST);
    expect(net.lead()).toHaveLength(1);
    expect(net.resend()).toHaveLength(1);
    expect(plan.create).toHaveBeenCalledTimes(1);
  });

  it('limits an email address to 3 unlocks an hour whatever the address, scan or capitalization (the third-party scenario)', async () => {
    const net = stubNetwork();
    const plan = planClient();
    const victim = ['victim@example.com', 'Victim@Example.com', 'VICTIM@example.com'];
    for (const email of victim) {
      const res = await unlock({ scanId: randomUuid(), industry: 'Retail', email }, { country: 'CA', ip: randomIp(), app: appWith(plan.client) });
      expect(res.status).toBe(200);
    }
    const res = await unlock({ scanId: randomUuid(), industry: 'Retail', email: 'victim@example.com' }, { country: 'CA', ip: randomIp(), app: appWith(plan.client) });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: 'rate_limited' });
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(net.resend()).toHaveLength(3);
    expect(net.graderActions().filter((a) => a === 'unlock').length).toBe(6); // 3 unlocks, 3 plan stores; none for the fourth

    // another address is unaffected
    const other = await unlock({ scanId: randomUuid(), industry: 'Retail', email: 'someone@example.com' }, { country: 'CA', app: appWith(plan.client) });
    expect(other.status).toBe(200);
  });

  it('does not store or log the address in a limiter name or a log line', async () => {
    const logs = captureLogs();
    stubNetwork();
    await unlock(gatedBody({ email: 'private.person@example.com' }));
    expect(logs.join('\n')).not.toContain('private.person');
  });
});

describe('plan budget', () => {
  it('writes a plan only while CHECKER_DAILY_PLANS has room', async () => {
    stubNetwork();
    const plan = planClient();
    const env = checkerEnv({ CHECKER_DAILY_PLANS: '1' });
    expect(((await (await unlock(gatedBody(), { env, app: appWith(plan.client) })).json()) as any).plan).not.toBeNull();
    const second = await unlock(gatedBody(), { env, app: appWith(plan.client) });
    expect(((await second.json()) as any).plan).toBeNull();
    expect(plan.create).toHaveBeenCalledTimes(1);
  });

  it('defaults to 300 a day and 0 switches plans off', async () => {
    stubNetwork();
    const plan = planClient();
    expect(((await (await unlock(gatedBody(), { env: checkerEnv({ CHECKER_DAILY_PLANS: '0' }), app: appWith(plan.client) })).json()) as any).plan).toBeNull();
    expect(plan.create).not.toHaveBeenCalled();
    const env = checkerEnv();
    await unlock(gatedBody(), { env, app: appWith(plan.client) });
    expect(await fixedCount(env, globalCheckerPlanName())).toBe(1);
  });

  it('does not use up the plan budget when DAILY_LLM_CAP has no room', async () => {
    stubNetwork();
    const plan = planClient();
    const env = checkerEnv({ DAILY_LLM_CAP: '0' });
    await unlock(gatedBody(), { env, app: appWith(plan.client) });
    expect(await fixedCount(env, globalCheckerPlanName())).toBe(0);
    expect(plan.create).not.toHaveBeenCalled();
  });

  it('matches numbers as whole numbers, not as pieces of other numbers', async () => {
    stubNetwork();
    // The report says "30-60 characters" and "(4 chars)"; "3" is not among them even though it sits inside "30".
    const reply = JSON.stringify({ summary: 'Start here.', items: [{ check_id: 'seo.title_tag', text: 'Take 3 steps to fix the title.' }] });
    const res = await unlock(gatedBody(), { app: appWith(planClient(reply).client) });
    expect(((await res.json()) as any).plan).toBeNull();
    const ok = JSON.stringify({ summary: 'Start here.', items: [{ check_id: 'seo.title_tag', text: 'Keep the title between 30 and 60 characters.' }] });
    const res2 = await unlock(gatedBody(), { app: appWith(planClient(ok).client) });
    expect(((await res2.json()) as any).plan).not.toBeNull();
  });
});

describe('the visitor email', () => {
  it('escapes markup that came from the report', async () => {
    const net = stubNetwork({
      grader: (p) =>
        p.action === 'unlock'
          ? {
              body: {
                ok: true,
                report_token: TOKEN,
                report: report({
                  host: 'evil<script>alert(1)</script>.example',
                  top_fixes: [{ check_id: 'seo.title_tag', title: '<img src=x onerror=alert(1)>Fish & Chips', fix: 'Use <b>bold</b> when a < b "quoted"' }],
                }),
              },
            }
          : defaultGrader(p),
    });
    await unlock(gatedBody());
    const mail = net.resend().find((c) => c.json.to[0] === 'jane@example.com')!.json;
    expect(mail.html).not.toMatch(/<script|<img|<b>/i);
    expect(mail.html).toContain('Fish &amp; Chips');
    expect(mail.html).toContain('&quot;quoted&quot;');
    expect(mail.subject).not.toMatch(/[<>]/);
  });

  it('logs checker_lead when the lead is delivered', async () => {
    const logs = captureLogs();
    stubNetwork();
    await unlock(gatedBody());
    expect(logs.some((l) => l.includes('"event":"checker_lead"') && l.includes('"delivery":"leadquik"'))).toBe(true);
    expect(logs.some((l) => l.includes('checker_unlock') && l.includes('"emailed":true'))).toBe(true);
  });

  it('shapes an unlock failure from the grader to ok, reason and fields', async () => {
    stubNetwork({ grader: () => ({ status: 400, body: { ok: false, reason: 'not_found', fields: { scanId: 'bad' }, details: 'LEAKVALUE', report: {} } }) });
    const text = await (await unlock(gatedBody())).text();
    expect(JSON.parse(text)).toEqual({ ok: false, reason: 'not_found', fields: { scanId: 'bad' } });
  });
});

describe('"Email me a copy" for a visitor outside the US', () => {
  it('is a second unlock with just an email: one email per scan and address per day, never a lead or a second plan', async () => {
    const net = stubNetwork();
    const plan = planClient();
    const scanId = randomUuid();
    const opts = { country: 'CA', app: appWith(plan.client) };

    const first = await unlock({ scanId, industry: 'trade' }, opts);
    expect(await first.json()).toMatchObject({ ok: true, emailed: false });
    expect(net.resend()).toHaveLength(0);

    const copy = await unlock({ scanId, email: 'visitor@example.com' }, { ...opts, ip: randomIp() });
    expect(copy.status).toBe(200);
    expect(await copy.json()).toMatchObject({ ok: true, report_token: TOKEN, emailed: true });
    expect(net.resend()).toHaveLength(1);
    expect(net.resend()[0]!.json.to).toEqual(['visitor@example.com']);
    expect(net.lead()).toHaveLength(0);
    expect(plan.create).toHaveBeenCalledTimes(1);

    const again = await unlock({ scanId, email: 'Visitor@Example.com' }, { ...opts, ip: randomIp() });
    expect(await again.json()).toMatchObject({ ok: true, emailed: false });
    expect(net.resend()).toHaveLength(1);

    const other = await unlock({ scanId, email: 'second@example.com' }, { ...opts, ip: randomIp() });
    expect(await other.json()).toMatchObject({ ok: true, emailed: true });
    expect(net.resend()).toHaveLength(2);
    expect(net.lead()).toHaveLength(0);
  });

  it('does not email twice when the first unlock already carried the address', async () => {
    const net = stubNetwork();
    const scanId = randomUuid();
    const opts = { country: 'CA' };
    const first = await unlock({ scanId, industry: 'retail', email: 'visitor@example.com' }, opts);
    expect(((await first.json()) as any).emailed).toBe(true);
    const again = await unlock({ scanId, industry: 'retail', email: 'visitor@example.com' }, { ...opts, ip: randomIp() });
    expect(((await again.json()) as any).emailed).toBe(false);
    expect(net.resend()).toHaveLength(1);
  });
});

describe('industry as a profile key or as text', () => {
  it.each([
    ['trade', 'Home services'],
    ['professional', 'Professional services'],
    ['health', 'Health and wellness'],
    ['retail', 'Restaurants and retail'],
    ['software', 'Software and online services'],
    ['general', 'Other local business'],
  ])('maps the key %s to its picker label in the lead notes and the plan prompt', async (key, label) => {
    const net = stubNetwork();
    const plan = planClient();
    const res = await unlock(gatedBody({ industry: key, profile: key }), { app: appWith(plan.client) });
    expect(res.status).toBe(200);
    expect(String(net.lead()[0]!.json.notes)).toContain(`Industry: ${label}\n`);
    expect(plan.create.mock.calls[0]![0].messages[0]!.content).toContain(`<industry>${label}</industry>`);
  });

  it('keeps other text as sanitized free text, and falls back to the profile key when industry is missing', async () => {
    const net = stubNetwork();
    await unlock(gatedBody({ industry: 'Dental <b>office</b> & care', profile: 'health' }));
    expect(String(net.lead()[0]!.json.notes)).toContain('Industry: Dental office & care\n');
    await unlock(gatedBody({ industry: undefined, profile: 'health' }));
    expect(String(net.lead()[1]!.json.notes)).toContain('Industry: Health and wellness\n');
    const none = await unlock(gatedBody({ industry: undefined }));
    expect(none.status).toBe(400);
    const open = await unlock({ scanId: randomUuid() }, { country: 'CA' }); // not gated: industry may be left out
    expect(open.status).toBe(200);
  });
});
