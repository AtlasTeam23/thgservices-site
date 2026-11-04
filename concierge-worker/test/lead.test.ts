import { reset } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { globalLeadName } from '../src/limits';
import { call, randomIp, randomUuid, testEnv } from './helpers';

const TEST_TURNSTILE_SECRET = '1x0000000000000000000000000000000AA'; // Cloudflare's published always-pass test secret
const LEADQUIK_URL = 'https://hooks.leadquik.example/concierge';

const validLead = (overrides: Record<string, unknown> = {}) => ({
  sessionId: randomUuid(),
  name: 'Jane Doe',
  phone: '(770) 555-1234',
  email: 'jane@example.com',
  business: 'Doe Plumbing',
  need: 'Missed calls after hours',
  callbackWindow: 'midday_11_1',
  consent: true,
  transcript: [
    { role: 'user', content: 'What do you do?', at: '2026-11-03T21:00:10.000Z' },
    { role: 'assistant', content: 'We help local businesses save time with AI.', at: '2026-11-03T21:00:14.000Z' },
  ],
  page: { url: 'https://thgservices.io/#ai-concierge', utm: { utm_source: 'google' } },
  ...overrides,
});

const post = (body: unknown, options: Parameters<typeof call>[1] = {}) => call('/lead', { body, ...options });
const resendEnv = (extra: Record<string, unknown> = {}) =>
  testEnv({ RESEND_API_KEY: 'placeholder-not-a-real-key', ...extra });

type Outcome = number | Error;
interface Routes {
  resend?: Outcome[];
  leadquik?: Outcome[];
  siteverify?: Outcome[];
}

/** Stubs global fetch and routes by host. Each queue is consumed in order; the last outcome repeats. */
const stubNetwork = (routes: Routes) => {
  const queues = { 'api.resend.com': [...(routes.resend ?? [])], 'hooks.leadquik.example': [...(routes.leadquik ?? [])], 'challenges.cloudflare.com': [...(routes.siteverify ?? [])] };
  const last: Record<string, Outcome | undefined> = {};
  const calls: Array<{ host: string; url: string; init: RequestInit | undefined }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const host = new URL(url).host;
    calls.push({ host, url, init });
    const queue = queues[host as keyof typeof queues];
    if (!queue) throw new Error(`unexpected network call to ${host}`);
    const next = queue.length > 0 ? queue.shift()! : last[host];
    if (next === undefined) throw new Error(`no stubbed outcome left for ${host}`);
    last[host] = next;
    if (next instanceof Error) throw next;
    const body = host === 'challenges.cloudflare.com' ? { success: next === 200 } : { id: 'stub' };
    return new Response(JSON.stringify(body), { status: next === 200 && host === 'challenges.cloudflare.com' ? 200 : next, headers: { 'content-type': 'application/json' } });
  });
  const to = (host: string) => calls.filter((c) => c.host === host);
  return { calls, resend: () => to('api.resend.com'), leadquik: () => to('hooks.leadquik.example'), siteverify: () => to('challenges.cloudflare.com') };
};

beforeEach(async () => {
  await reset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('POST /lead delivery', () => {
  it('emails the lead through Resend and answers 200 delivery: email', async () => {
    const net = stubNetwork({ resend: [200] });
    const res = await post(validLead(), { env: resendEnv() });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://thgservices.io');
    expect(await res.json()).toEqual({ ok: true, delivery: 'email' });

    expect(net.resend()).toHaveLength(1);
    expect(net.leadquik()).toHaveLength(0);
    const sent = JSON.parse(String(net.resend()[0]!.init!.body)) as Record<string, string | string[]>;
    expect(sent.to).toEqual(['developer@leadquik.com']);
    expect(sent.from).toBe('THG AI Services <concierge@leadquik.com>');
    expect(sent.subject).toBe('New website lead: Doe Plumbing — Jane Doe');
    expect(sent.reply_to).toBe('jane@example.com');
    expect(String(sent.text)).toContain('(770) 555-1234');
    expect(String(sent.text)).toContain('Midday (11 AM–1 PM ET)');
    expect(String(sent.text)).toMatch(/\[\d{1,2}:\d{2} [AP]M\] You: What do you do\?/);
    expect(String(sent.text)).toMatch(/ ET\b/);
  });

  it('retries a failed Resend call once: 500 then 200 is a success with two calls', async () => {
    const net = stubNetwork({ resend: [500, 200] });
    const res = await post(validLead(), { env: resendEnv() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, delivery: 'email' });
    expect(net.resend()).toHaveLength(2);
  });

  it('answers 502 delivery_failed when Resend fails twice and LeadQuik is not configured', async () => {
    const net = stubNetwork({ resend: [500, 500] });
    const res = await post(validLead(), { env: resendEnv() });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: 'delivery_failed' });
    expect(net.resend()).toHaveLength(2);
    expect(net.leadquik()).toHaveLength(0);
  });

  it('answers 502 without any network call when there is no Resend key and no LeadQuik hook', async () => {
    const net = stubNetwork({});
    const res = await post(validLead(), { env: testEnv() });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: 'delivery_failed' });
    expect(net.calls).toHaveLength(0);
  });

  it('answers 200 delivery: leadquik when Resend fails but the LeadQuik hook succeeds', async () => {
    const net = stubNetwork({ resend: [500, 500], leadquik: [200] });
    const res = await post(validLead(), { env: resendEnv({ LEADQUIK_WEBHOOK_URL: LEADQUIK_URL }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, delivery: 'leadquik' });
    expect(net.leadquik()).toHaveLength(1);
  });

  it('answers 200 delivery: leadquik when only the hook is configured', async () => {
    const net = stubNetwork({ leadquik: [200] });
    const res = await post(validLead(), { env: testEnv({ LEADQUIK_WEBHOOK_URL: LEADQUIK_URL }) });
    expect(await res.json()).toEqual({ ok: true, delivery: 'leadquik' });
    expect(net.resend()).toHaveLength(0);
  });

  it('answers 200 delivery: email+leadquik when both succeed', async () => {
    const net = stubNetwork({ resend: [200], leadquik: [200] });
    const res = await post(validLead(), { env: resendEnv({ LEADQUIK_WEBHOOK_URL: LEADQUIK_URL }) });
    expect(await res.json()).toEqual({ ok: true, delivery: 'email+leadquik' });
    expect(net.resend()).toHaveLength(1);
    expect(net.leadquik()).toHaveLength(1);
  });

  it('still answers delivery: email when the email works but the hook fails', async () => {
    stubNetwork({ resend: [200], leadquik: [500] });
    const res = await post(validLead(), { env: resendEnv({ LEADQUIK_WEBHOOK_URL: LEADQUIK_URL }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, delivery: 'email' });
  });

  it('answers 502 when both Resend and the hook fail', async () => {
    stubNetwork({ resend: [500, 500], leadquik: [new TypeError('down')] });
    const res = await post(validLead(), { env: resendEnv({ LEADQUIK_WEBHOOK_URL: LEADQUIK_URL }) });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: 'delivery_failed' });
  });

  it('does not call LeadQuik when the hook URL is empty or blank', async () => {
    for (const LEADQUIK_WEBHOOK_URL of ['', '   ', undefined]) {
      const net = stubNetwork({ resend: [200] });
      await post(validLead(), { env: resendEnv({ LEADQUIK_WEBHOOK_URL }) });
      expect(net.leadquik()).toHaveLength(0);
      vi.restoreAllMocks();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
    }
  });

  it('refuses a hook URL that is not https', async () => {
    const net = stubNetwork({ resend: [500, 500] });
    const res = await post(validLead(), { env: resendEnv({ LEADQUIK_WEBHOOK_URL: 'http://hooks.leadquik.example/x' }) });
    expect(res.status).toBe(502);
    expect(net.leadquik()).toHaveLength(0);
  });

  it('posts the documented LeadQuik payload', async () => {
    const net = stubNetwork({ resend: [200], leadquik: [200] });
    const lead = validLead({ phone: '1-770-555-1234', email: '' });
    await post(lead, { env: resendEnv({ LEADQUIK_WEBHOOK_URL: LEADQUIK_URL }) });

    const request = net.leadquik()[0]!;
    expect(request.url).toBe(LEADQUIK_URL);
    expect(request.init?.method).toBe('POST');
    expect(new Headers(request.init?.headers).get('Content-Type')).toBe('application/json');
    const payload = JSON.parse(String(request.init?.body)) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ['business', 'callbackWindow', 'consent', 'createdAt', 'email', 'name', 'need', 'phone', 'source', 'transcript'].sort(),
    );
    expect(payload).toMatchObject({
      name: 'Jane Doe',
      phone: '7705551234',
      email: '',
      business: 'Doe Plumbing',
      need: 'Missed calls after hours',
      callbackWindow: 'midday_11_1',
      source: 'thgservices.io concierge',
      consent: true,
    });
    expect(new Date(String(payload.createdAt)).toISOString()).toBe(payload.createdAt);
    expect(payload.transcript).toEqual([
      { role: 'user', content: 'What do you do?', at: '2026-11-03T21:00:10.000Z' },
      { role: 'assistant', content: 'We help local businesses save time with AI.', at: '2026-11-03T21:00:14.000Z' },
    ]);
  });

  it('leaves reply_to out of the email when the visitor gave no address', async () => {
    const net = stubNetwork({ resend: [200] });
    await post(validLead({ email: undefined }), { env: resendEnv() });
    expect(JSON.parse(String(net.resend()[0]!.init!.body))).not.toHaveProperty('reply_to');
  });

  it('does not log names, phone numbers, emails or transcript text', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'warn').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
    stubNetwork({ resend: [500, 500] });
    await post(validLead(), { env: resendEnv() });
    stubNetwork({ resend: [200] });
    await post(validLead(), { env: resendEnv() });
    const text = lines.join('\n');
    for (const secret of ['Jane', 'Doe Plumbing', '7705551234', 'jane@example.com', 'What do you do', 'placeholder-not-a-real-key']) {
      expect(text, secret).not.toContain(secret);
    }
  });
});

describe('POST /lead validation', () => {
  it('answers 400 with per-field messages and calls nobody', async () => {
    const net = stubNetwork({});
    const res = await post(
      validLead({ phone: '770555123', email: 'nope', consent: false, name: '', business: ' ', callbackWindow: 'evening' }),
      { env: resendEnv({ LEADQUIK_WEBHOOK_URL: LEADQUIK_URL }) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string; fields: Record<string, string> };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('validation');
    expect(body.fields.phone).toBe('Enter a 10-digit US phone number');
    expect(Object.keys(body.fields).sort()).toEqual(['business', 'callbackWindow', 'consent', 'email', 'name', 'phone']);
    expect(net.calls).toHaveLength(0);
  });

  it.each([
    ['a bad phone number', { phone: '555-1234' }, 'phone'],
    ['a bad email', { email: 'not-an-email' }, 'email'],
    ['missing consent', { consent: undefined }, 'consent'],
    ['consent that is not literally true', { consent: 'yes' }, 'consent'],
    ['a callback window outside the list', { callbackWindow: 'weekend' }, 'callbackWindow'],
  ])('rejects %s', async (_label, overrides, field) => {
    const net = stubNetwork({});
    const res = await post(validLead(overrides), { env: resendEnv() });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields: Record<string, string> }).fields).toHaveProperty(field);
    expect(net.resend()).toHaveLength(0);
  });

  it.each([
    ['malformed JSON', '{"name":'],
    ['a JSON array', '[]'],
    ['an empty body', ''],
  ])('answers 400 validation for %s', async (_label, body) => {
    const res = await post(body, { env: resendEnv() });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'validation', fields: {} });
  });

  it('accepts a body just under the 128 KB cap and rejects one over it, on size alone', async () => {
    // `padding` is not a lead field, so the only thing that can reject the larger body is its size.
    stubNetwork({ resend: [200] });
    const under = await post(JSON.stringify(validLead({ padding: 'x'.repeat(100_000) })), { env: resendEnv() });
    expect(under.status).toBe(200);
    const over = await post(JSON.stringify(validLead({ padding: 'x'.repeat(140_000) })), { env: resendEnv() });
    expect(over.status).toBe(400);
    expect(await over.json()).toEqual({ ok: false, error: 'validation', fields: {} });
  });

  it('puts the cap between 128 KB minus a little and a little over, in bytes (not characters)', async () => {
    stubNetwork({ resend: [200] });
    const wrap = (padding: string) => JSON.stringify(validLead({ padding }));
    const bytes = (text: string) => new TextEncoder().encode(text).length;
    const base = bytes(wrap(''));
    const fit = wrap('x'.repeat(131_072 - base - 64)); // 64 bytes of headroom under 128 KB
    const spill = wrap('x'.repeat(131_072 - base + 64)); // 64 bytes over
    expect(bytes(fit)).toBeLessThan(131_072);
    expect(bytes(spill)).toBeGreaterThan(131_072);
    expect((await post(fit, { env: resendEnv() })).status).toBe(200);
    expect((await post(spill, { env: resendEnv() })).status).toBe(400);
  });

  it('accepts a maximal legitimate lead: 60 transcript entries of 1,000 characters plus every field at its limit', async () => {
    const net = stubNetwork({ resend: [200] });
    // 1,000 characters each, with 2-byte characters and quotes that JSON must escape, so the body is bigger than the character count.
    const unit = 'Ünï"cödé"é;é';
    const content = unit.repeat(84).slice(0, 1000);
    expect(content).toHaveLength(1000);
    const lead = validLead({
      name: 'N'.repeat(80),
      business: 'B'.repeat(120),
      need: 'n'.repeat(500),
      page: {
        url: 'https://thgservices.io/?q=' + 'a'.repeat(474),
        utm: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`utm_k${i}`, 'v'.repeat(100)])),
      },
      transcript: Array.from({ length: 60 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content,
        at: `2026-11-03T21:${String(i).padStart(2, '0')}:00.000Z`,
      })),
    });
    const body = JSON.stringify(lead);
    const size = new TextEncoder().encode(body).length;
    expect(size).toBeGreaterThan(64 * 1024); // the old 64 KB cap would have refused this lead
    expect(size).toBeLessThan(128 * 1024);

    const res = await post(body, { env: resendEnv() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, delivery: 'email' });
    const sent = JSON.parse(String(net.resend()[0]!.init!.body)) as { text: string };
    expect(sent.text.split('\n').filter((line) => line.startsWith('[')).length).toBe(60); // every transcript line made it
  });

  it('rejects a hostile 140 KB "<a<a<a..." body on size, quickly, without reading it all', async () => {
    const net = stubNetwork({ resend: [200] });
    const started = performance.now();
    const res = await post(JSON.stringify(validLead({ name: '<a'.repeat(70_000) })), { env: resendEnv() });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'validation', fields: {} }); // refused before it was parsed
    expect(performance.now() - started).toBeLessThan(100);
    expect(net.calls).toHaveLength(0);
  });

  it('rejects a hostile 100 KB value that fits under the cap, quickly, with the field message and no sanitizing', async () => {
    const net = stubNetwork({ resend: [200] });
    const started = performance.now();
    const res = await post(JSON.stringify(validLead({ name: '<a'.repeat(50_000) })), { env: resendEnv() });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields: Record<string, string> }).fields).toEqual({ name: 'Name must be 80 characters or fewer' });
    expect(performance.now() - started).toBeLessThan(100);
    expect(net.calls).toHaveLength(0);
  });

  it('rejects hostile field values under the body cap quickly, with the field message', async () => {
    const net = stubNetwork({ resend: [200] });
    const started = performance.now();
    // 3 x 10 KB: under the 64 KB body cap, so field validation (not the size check) must reject it.
    const res = await post(validLead({ name: '<a'.repeat(5_000), business: '<a'.repeat(5_000), need: '<a'.repeat(5_000) }), { env: resendEnv() });
    expect(res.status).toBe(400);
    const { fields } = (await res.json()) as { fields: Record<string, string> };
    expect(Object.keys(fields).sort()).toEqual(['business', 'name', 'need']);
    expect(performance.now() - started).toBeLessThan(100);
    expect(net.calls).toHaveLength(0);
  });

  it('answers 405 to a GET', async () => {
    const res = await call('/lead', { method: 'GET' });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST, OPTIONS');
  });

  it('sanitizes before sending: markup is stripped and line breaks cannot reach the subject', async () => {
    const net = stubNetwork({ resend: [200] });
    await post(validLead({ name: 'Jane\r\nBcc: x@evil.example', business: '<b>Doe</b> Plumbing' }), { env: resendEnv() });
    const sent = JSON.parse(String(net.resend()[0]!.init!.body)) as { subject: string; html: string };
    expect(sent.subject).toBe('New website lead: Doe Plumbing — Jane Bcc: x@evil.example');
  });
});

describe('POST /lead rate limit', () => {
  it('allows 3 leads per IP per hour and answers 429 to the 4th', async () => {
    stubNetwork({ resend: [200] });
    const ip = randomIp();
    for (let i = 1; i <= 3; i += 1) {
      expect((await post(validLead(), { env: resendEnv(), ip })).status, `lead ${i}`).toBe(200);
    }
    const res = await post(validLead(), { env: resendEnv(), ip });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: 'rate_limited' });
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    // Another address is unaffected.
    expect((await post(validLead(), { env: resendEnv(), ip: randomIp() })).status).toBe(200);
  });

  it('does not use up the allowance on invalid submissions', async () => {
    stubNetwork({ resend: [200] });
    const ip = randomIp();
    for (let i = 0; i < 5; i += 1) {
      expect((await post(validLead({ phone: 'x' }), { env: resendEnv(), ip })).status).toBe(400);
    }
    for (let i = 1; i <= 3; i += 1) {
      expect((await post(validLead(), { env: resendEnv(), ip })).status, `lead ${i}`).toBe(200);
    }
  });

  it('answers 429 before spending anything on delivery', async () => {
    const net = stubNetwork({ resend: [200] });
    const ip = randomIp();
    for (let i = 0; i < 3; i += 1) await post(validLead(), { env: resendEnv(), ip });
    const before = net.resend().length;
    await post(validLead(), { env: resendEnv(), ip });
    expect(net.resend()).toHaveLength(before);
  });
});

describe('POST /lead Turnstile', () => {
  const env = () => resendEnv({ TURNSTILE_SECRET_KEY: TEST_TURNSTILE_SECRET });

  it('answers 403 verification_failed with no token, and sends nothing', async () => {
    const net = stubNetwork({ resend: [200], siteverify: [200] });
    const res = await post(validLead(), { env: env() });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'verification_failed' });
    expect(net.resend()).toHaveLength(0);
  });

  it('answers 403 verification_failed when the token does not verify', async () => {
    const net = stubNetwork({ resend: [200], siteverify: [400] }); // stub answers success: false
    const res = await post(validLead({ turnstileToken: 'bad-token' }), { env: env() });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'verification_failed' });
    expect(net.resend()).toHaveLength(0);
  });

  it('delivers when the token verifies, passing Cloudflare the secret, token and caller IP', async () => {
    const net = stubNetwork({ resend: [200], siteverify: [200] });
    const ip = randomIp();
    const res = await post(validLead({ turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' }), { env: env(), ip });
    expect(res.status).toBe(200);
    const form = net.siteverify()[0]!.init!.body as URLSearchParams;
    expect(form.get('secret')).toBe(TEST_TURNSTILE_SECRET);
    expect(form.get('response')).toBe('XXXX.DUMMY.TOKEN.XXXX');
    expect(form.get('remoteip')).toBe(ip);
    expect(net.resend()).toHaveLength(1);
  });

  it('skips verification when no Turnstile secret is configured', async () => {
    const net = stubNetwork({ resend: [200] });
    const res = await post(validLead(), { env: resendEnv() });
    expect(res.status).toBe(200);
    expect(net.siteverify()).toHaveLength(0);
  });

  it('validates first, so a malformed lead never reaches Cloudflare', async () => {
    const net = stubNetwork({ siteverify: [200] });
    await post(validLead({ phone: 'x', turnstileToken: 'tok' }), { env: env() });
    expect(net.siteverify()).toHaveLength(0);
  });
});

describe('POST /lead when the limiter is unavailable', () => {
  const brokenLimiter = { getByName: () => ({ hit: () => Promise.reject(new Error('do exploded')), end: () => Promise.reject(new Error('do exploded')) }) };

  it('still verifies and delivers the lead, and logs limiter_error', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => void lines.push(args.map(String).join(' ')));
    const net = stubNetwork({ resend: [200] });
    const res = await post(validLead(), { env: resendEnv({ LIMITER: brokenLimiter }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, delivery: 'email' });
    expect(net.resend()).toHaveLength(1);
    // one line for the per-IP check and one for the daily cap
    expect(lines.filter((line) => line.includes('"event":"limiter_error"'))).toHaveLength(2);
    expect(lines.join('\n')).not.toMatch(/exploded/);
  });

  it('still enforces Turnstile when the limiter is down', async () => {
    const net = stubNetwork({ resend: [200], siteverify: [200] });
    const env = resendEnv({ LIMITER: brokenLimiter, TURNSTILE_SECRET_KEY: TEST_TURNSTILE_SECRET });
    const res = await post(validLead(), { env }); // no token
    expect(res.status).toBe(403);
    expect(net.resend()).toHaveLength(0);
    const ok = await post(validLead({ turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' }), { env });
    expect(ok.status).toBe(200);
  });

  it('still validates when the limiter is down', async () => {
    stubNetwork({ resend: [200] });
    const res = await post(validLead({ phone: 'x' }), { env: resendEnv({ LIMITER: brokenLimiter }) });
    expect(res.status).toBe(400);
  });

  it('keeps the per-IP limit when only the daily counter fails', async () => {
    stubNetwork({ resend: [200] });
    const realLimiter = (await import('cloudflare:workers')).env.LIMITER;
    const partial = { getByName: (name: string) => (name.startsWith('global:') ? brokenLimiter.getByName() : realLimiter.getByName(name)) };
    const ip = randomIp();
    for (let i = 1; i <= 3; i += 1) {
      expect((await post(validLead(), { env: resendEnv({ LIMITER: partial }), ip })).status, `lead ${i}`).toBe(200);
    }
    expect((await post(validLead(), { env: resendEnv({ LIMITER: partial }), ip })).status).toBe(429);
  });
});

describe('POST /lead daily cap (100 per Eastern-time day)', () => {
  const dayStub = () => import('cloudflare:workers').then(({ env }) => env.LIMITER.getByName(globalLeadName()));
  const fill = async (n: number) => {
    const stub = await dayStub();
    for (let i = 0; i < n; i += 1) await stub.hit(100, 86400, 'fixed');
  };

  it('delivers the 100th lead and answers the existing 429 rate_limited body to the 101st', async () => {
    const net = stubNetwork({ resend: [200] });
    await fill(99);
    expect((await post(validLead(), { env: resendEnv() })).status).toBe(200); // the 100th
    const res = await post(validLead(), { env: resendEnv() });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: 'rate_limited' });
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(net.resend()).toHaveLength(1); // the refused lead never reached Resend
  });

  it('counts real requests against the shared counter, one per delivered lead', async () => {
    stubNetwork({ resend: [200] });
    for (let i = 0; i < 5; i += 1) await post(validLead(), { env: resendEnv() });
    const stub = await dayStub();
    expect((await stub.hit(100, 86400, 'fixed')).count).toBe(6); // 5 leads + this probe
  });

  it('is shared by every visitor: a hundred different addresses fill it', async () => {
    stubNetwork({ resend: [200] });
    for (let i = 1; i <= 100; i += 1) {
      const res = await post(validLead(), { env: resendEnv(), ip: randomIp() });
      expect(res.status, `lead ${i}`).toBe(200);
    }
    expect((await post(validLead(), { env: resendEnv(), ip: randomIp() })).status).toBe(429);
  });

  it('is checked after Turnstile: a failed verification does not use it up', async () => {
    stubNetwork({ resend: [200], siteverify: [400] }); // siteverify says no
    const env = resendEnv({ TURNSTILE_SECRET_KEY: TEST_TURNSTILE_SECRET });
    await fill(99);
    for (let i = 0; i < 3; i += 1) {
      expect((await post(validLead({ turnstileToken: 'bad' }), { env })).status).toBe(403);
    }
    vi.restoreAllMocks();
    stubNetwork({ resend: [200] });
    expect((await post(validLead(), { env: resendEnv() })).status).toBe(200); // the 100th is still there
  });

  it('is not used up by invalid submissions or by a visitor who is over the per-IP limit', async () => {
    stubNetwork({ resend: [200] });
    await fill(96);
    for (let i = 0; i < 5; i += 1) expect((await post(validLead({ phone: 'x' }), { env: resendEnv() })).status).toBe(400);
    const ip = randomIp();
    for (let i = 1; i <= 3; i += 1) expect((await post(validLead(), { env: resendEnv(), ip })).status, `lead ${i}`).toBe(200); // 99 used
    for (let i = 0; i < 4; i += 1) expect((await post(validLead(), { env: resendEnv(), ip })).status).toBe(429); // per-IP refusals
    expect((await post(validLead(), { env: resendEnv(), ip: randomIp() })).status).toBe(200); // the 100th is still there
    expect((await post(validLead(), { env: resendEnv(), ip: randomIp() })).status).toBe(429); // and now it is gone
  });

  it('counts a lead as soon as it is attempted, even if every delivery path then fails', async () => {
    // Known trade-off: the counter has no refund, so a Resend outage with many visitors can use the day's allowance.
    stubNetwork({ resend: [500, 500] });
    const res = await post(validLead(), { env: resendEnv() });
    expect(res.status).toBe(502);
    const stub = await dayStub();
    expect((await stub.hit(100, 86400, 'fixed')).count).toBe(2); // the failed lead did count: it was attempted
  });
});

describe('POST /lead secrets are trimmed once and used trimmed', () => {
  it('sends the Resend key without surrounding whitespace', async () => {
    const net = stubNetwork({ resend: [200] });
    await post(validLead(), { env: testEnv({ RESEND_API_KEY: '  placeholder-not-a-real-key\n' }) });
    expect(new Headers(net.resend()[0]!.init?.headers).get('Authorization')).toBe('Bearer placeholder-not-a-real-key');
  });

  it('calls the LeadQuik hook at its trimmed URL', async () => {
    const net = stubNetwork({ leadquik: [200] });
    const res = await post(validLead(), { env: testEnv({ LEADQUIK_WEBHOOK_URL: `\n  ${LEADQUIK_URL}  ` }) });
    expect(await res.json()).toEqual({ ok: true, delivery: 'leadquik' });
    expect(net.leadquik()[0]!.url).toBe(LEADQUIK_URL);
  });

  it('treats a whitespace-only hook URL as not configured', async () => {
    const net = stubNetwork({ resend: [200] });
    await post(validLead(), { env: resendEnv({ LEADQUIK_WEBHOOK_URL: '  \n ' }) });
    expect(net.leadquik()).toHaveLength(0);
  });

  it('sends the Turnstile secret trimmed, and treats a whitespace-only one as not configured', async () => {
    const net = stubNetwork({ resend: [200], siteverify: [200] });
    await post(validLead({ turnstileToken: 'tok' }), { env: resendEnv({ TURNSTILE_SECRET_KEY: `  ${TEST_TURNSTILE_SECRET}\n` }) });
    expect((net.siteverify()[0]!.init!.body as URLSearchParams).get('secret')).toBe(TEST_TURNSTILE_SECRET);

    const blank = stubNetwork({ resend: [200] });
    const res = await post(validLead(), { env: resendEnv({ TURNSTILE_SECRET_KEY: '   ' }) });
    expect(res.status).toBe(200);
    expect(blank.siteverify()).toHaveLength(0);
  });
});

describe('POST /lead email details', () => {
  it('rejects an email address that could split into several recipients, with the field message', async () => {
    const net = stubNetwork({ resend: [200] });
    for (const email of ['jane@example.com,evil@example.org', 'Jane <jane@example.com>', '"jane"@example.com']) {
      const res = await post(validLead({ email }), { env: resendEnv() });
      expect(res.status, email).toBe(400);
      expect(((await res.json()) as { fields: Record<string, string> }).fields.email).toBe('Enter a valid email address');
    }
    expect(net.resend()).toHaveLength(0);
  });

  it('only links the page URL when it is on thgservices.io', async () => {
    const net = stubNetwork({ resend: [200, 200] });
    await post(validLead({ page: { url: 'https://evil.example/phish', utm: {} } }), { env: resendEnv() });
    await post(validLead({ page: { url: 'https://www.thgservices.io/#ai-concierge', utm: {} } }), { env: resendEnv() });
    const [evil, own] = net.resend().map((c) => (JSON.parse(String(c.init!.body)) as { html: string }).html);
    expect(evil).not.toContain('href="https://evil.example');
    expect(evil).toContain('https://evil.example/phish');
    expect(own).toContain('href="https://www.thgservices.io/#ai-concierge"');
  });
});
