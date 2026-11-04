import { reset, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/index';
import { globalTtsName, secondsToEtMidnight, ttsBonusIpName, ttsSpokenIpName } from '../src/limits';
import { aiStub, call, captureLogs, chatOnce, fixedCount, randomIp, randomUuid, setWindowEnd, testEnv } from './helpers';

// The per-visitor cap on the paid reply voice: PER_IP replies per address per Eastern-time day, plus BONUS
// more once that address has left a name, a valid email and a phone number through /lead. Providers are
// stubbed (ElevenLabs by fetch, Aura by a binding stub), and so is Resend.

const KEY = 'sk_placeholder_not_a_real_key_0123456789';
const VOICE = '21m00Tcm4TlvDq8ikWAM';
const MP3 = Uint8Array.from([0xff, 0xf3, 0x60, 0xc4, 0, 1, 2, 3]);

const plainApp = createApp({ voice: { retryDelayMs: 0, timeoutMs: 200 } });

let session = '';
const body = (text: unknown = 'Hi.', sessionId: unknown = session) => ({ sessionId, text });

/** The default cap (5 + 5): nothing here lifts it. */
const elevenEnv = (extra: Record<string, unknown> = {}) =>
  testEnv({
    VOICE_TTS: 'elevenlabs',
    ELEVENLABS_API_KEY: KEY,
    VOICE_ELEVEN_VOICE_ID: VOICE,
    RESEND_API_KEY: 'placeholder-not-a-real-key',
    ...extra,
  });

interface Network {
  eleven: string[];
  resend: string[];
}

/** One fetch stub for both hosts. `elevenStatus` decides ElevenLabs' answer per call; Resend always accepts. */
const stubNetwork = (elevenStatus: (n: number) => number = () => 200): Network => {
  const seen: Network = { eleven: [], resend: [] };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const host = new URL(String(input)).host;
    if (host === 'api.elevenlabs.io') {
      seen.eleven.push(String(input));
      const status = elevenStatus(seen.eleven.length);
      return status === 200 ? new Response(MP3, { status: 200 }) : new Response('{"detail":"nope"}', { status });
    }
    if (host === 'api.resend.com') {
      seen.resend.push(String(input));
      return new Response(JSON.stringify({ id: 'stub' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected network call to ${host}`);
  });
  return seen;
};

const speak = (options: Parameters<typeof call>[1] = {}, text: unknown = 'Hi.') =>
  call('/tts', { body: body(text), app: plainApp, ...options });

/** Statuses of `count` replies asked for from one address. */
const speakTimes = async (count: number, options: Parameters<typeof call>[1]): Promise<number[]> => {
  const statuses: number[] = [];
  for (let i = 0; i < count; i += 1) statuses.push((await speak(options)).status);
  return statuses;
};

const leadBody = (overrides: Record<string, unknown> = {}) => ({
  sessionId: randomUuid(),
  name: 'Jane Doe',
  phone: '(770) 555-1234',
  email: 'jane@example.com',
  business: 'Doe Plumbing',
  need: 'Missed calls after hours',
  callbackWindow: 'midday_11_1',
  consent: true,
  transcript: [{ role: 'user', content: 'What do you do?', at: '2026-11-03T21:00:10.000Z' }],
  page: { url: 'https://thgservices.io/', utm: {} },
  ...overrides,
});

const lead = (overrides: Record<string, unknown>, options: Parameters<typeof call>[1]) =>
  call('/lead', { body: leadBody(overrides), app: plainApp, ...options });

/** A refusal because the day's allowance is spent: `bonusAvailable`, and `bonus` (the size of the bonus, whatever its state). */
const isCapped = async (res: Response, bonusAvailable: boolean, bonus = 5) => {
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({ error: 'tts_limit', bonusAvailable, bonus });
};

beforeEach(async () => {
  await reset();
  session = await chatOnce();
});
afterEach(() => vi.restoreAllMocks());

describe('the per-visitor cap: 5 spoken replies a day', () => {
  it('serves five and then answers 429 tts_limit with bonusAvailable true, without calling the provider', async () => {
    const network = stubNetwork();
    const env = elevenEnv();
    const ip = randomIp();
    expect(await speakTimes(5, { env, ip })).toEqual([200, 200, 200, 200, 200]);
    const sixth = await speak({ env, ip });
    await isCapped(sixth, true);
    expect(network.eleven).toHaveLength(5);
  });

  it('sends Retry-After as the seconds left until Eastern midnight', async () => {
    stubNetwork();
    const env = elevenEnv({ VOICE_TTS_PER_IP_PER_DAY: '1' });
    const ip = randomIp();
    await speak({ env, ip });
    const capped = await speak({ env, ip });
    await isCapped(capped, true);
    const retryAfter = Number(capped.headers.get('Retry-After'));
    expect(Math.abs(retryAfter - secondsToEtMidnight(new Date()))).toBeLessThanOrEqual(2);
    expect(capped.headers.get('Cache-Control')).toBe('no-store');
  });

  it("sends Retry-After from the counter's own window end, not from the wall clock", async () => {
    stubNetwork();
    const env = elevenEnv({ VOICE_TTS_PER_IP_PER_DAY: '1' });
    const ip = randomIp();
    await speak({ env, ip });
    await setWindowEnd(env, await ttsSpokenIpName(ip, env.RATE_SALT), Date.now() + 90_000);
    const capped = await speak({ env, ip });
    await isCapped(capped, true);
    const retryAfter = Number(capped.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThanOrEqual(88);
    expect(retryAfter).toBeLessThanOrEqual(90);
  });

  it('cannot answer about a day when the clock has just passed midnight but the counter has not: Retry-After follows the counter', async () => {
    stubNetwork();
    // The Worker's clock says one second past Eastern midnight (so "seconds to midnight" would be 86,399)...
    const afterMidnight = new Date('2026-11-04T05:00:01Z');
    const app = createApp({ voice: { retryDelayMs: 0, timeoutMs: 200, now: () => afterMidnight } });
    const env = elevenEnv({ VOICE_TTS_PER_IP_PER_DAY: '1' });
    const ip = randomIp();
    await speak({ env, ip, app });
    // ...but the counter's window ends in 30 seconds.
    await setWindowEnd(env, await ttsSpokenIpName(ip, env.RATE_SALT), Date.now() + 30_000);
    const capped = await speak({ env, ip, app });
    await isCapped(capped, true);
    const retryAfter = Number(capped.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThanOrEqual(28);
    expect(retryAfter).toBeLessThanOrEqual(30);
  });

  it('is per address: another address still gets its five', async () => {
    stubNetwork();
    const env = elevenEnv();
    const ip = randomIp();
    await speakTimes(5, { env, ip });
    await isCapped(await speak({ env, ip }), true);
    expect(await speakTimes(5, { env, ip: randomIp() })).toEqual([200, 200, 200, 200, 200]);
  });

  it('is shared by an IPv6 /64, the way every address bucket is', async () => {
    stubNetwork();
    const env = elevenEnv({ VOICE_TTS_PER_IP_PER_DAY: '2' });
    expect(await speakTimes(2, { env, ip: '2001:db8:1:2:aaaa::1' })).toEqual([200, 200]);
    await isCapped(await speak({ env, ip: '2001:db8:1:2:bbbb::9' }), true);
  });

  it('follows VOICE_TTS_PER_IP_PER_DAY', async () => {
    stubNetwork();
    const env = elevenEnv({ VOICE_TTS_PER_IP_PER_DAY: '2' });
    const ip = randomIp();
    expect(await speakTimes(2, { env, ip })).toEqual([200, 200]);
    await isCapped(await speak({ env, ip }), true);
  });

  it('reports the size of the bonus, as a number, in the refusal, so the widget can say what the form is worth', async () => {
    stubNetwork();
    const env = elevenEnv({ VOICE_TTS_PER_IP_PER_DAY: '1', VOICE_TTS_BONUS: '7' });
    const ip = randomIp();
    await speak({ env, ip });
    const capped = await speak({ env, ip });
    expect(capped.status).toBe(429);
    const refusal = (await capped.json()) as { bonus: unknown; bonusAvailable: unknown };
    expect(refusal.bonus).toBe(7);
    expect(typeof refusal.bonus).toBe('number');
    expect(refusal.bonusAvailable).toBe(true);
  });

  it('never offers a bonus that is worth nothing: with VOICE_TTS_BONUS=0, bonusAvailable is false and bonus is 0', async () => {
    const network = stubNetwork();
    const env = elevenEnv({ VOICE_TTS_PER_IP_PER_DAY: '2', VOICE_TTS_BONUS: '0' });
    const ip = randomIp();
    expect(await speakTimes(2, { env, ip })).toEqual([200, 200]);
    await isCapped(await speak({ env, ip }), false, 0);
    // A lead is still welcome, but it unlocks nothing, so the answer does not change.
    expect((await lead({}, { env, ip })).status).toBe(200);
    await isCapped(await speak({ env, ip }), false, 0);
    expect(network.eleven).toHaveLength(2);
  });

  it('applies to Aura too, not just ElevenLabs', async () => {
    const stub = aiStub(() => new Response(MP3, { headers: { 'Content-Type': 'audio/mpeg' } }));
    const env = testEnv({ AI: stub.ai, VOICE_TTS: 'aura' });
    const ip = randomIp();
    expect(await speakTimes(5, { env, ip })).toEqual([200, 200, 200, 200, 200]);
    await isCapped(await speak({ env, ip }), true);
    expect(stub.run).toHaveBeenCalledTimes(5);
  });

  it('with a cap of 0 only the bonus is left: the first request is refused, and a lead opens it up', async () => {
    const network = stubNetwork();
    const env = elevenEnv({ VOICE_TTS_PER_IP_PER_DAY: '0' });
    const ip = randomIp();
    await isCapped(await speak({ env, ip }), true);
    expect(network.eleven).toHaveLength(0);
    expect((await lead({}, { env, ip })).status).toBe(200);
    expect(await speakTimes(5, { env, ip })).toEqual([200, 200, 200, 200, 200]);
    await isCapped(await speak({ env, ip }), false);
  });

  it('still counts a refused request against the 30-per-10-minutes abuse limit, which stays as the backstop', async () => {
    stubNetwork();
    const env = elevenEnv({ VOICE_TTS_PER_IP_PER_DAY: '1' });
    const ip = randomIp();
    await speak({ env, ip });
    for (let i = 2; i <= 30; i += 1) await isCapped(await speak({ env, ip }), true);
    const res = await speak({ env, ip });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' }); // the abuse limit answers now, not the daily cap
  });

  it('does not touch the character budget for a request the cap refused', async () => {
    stubNetwork();
    const env = elevenEnv({ VOICE_TTS_PER_IP_PER_DAY: '1' });
    const ip = randomIp();
    await speak({ env, ip }, 'Hello there.');
    const before = await fixedCount(env, globalTtsName());
    await isCapped(await speak({ env, ip }, 'Hello there.'), true);
    expect(await fixedCount(env, globalTtsName())).toBe(before);
  });
});

describe('the bonus: a lead with a name, a valid email and a phone number', () => {
  it('grants five more: replies 6 to 10 succeed and the 11th is 429 with bonusAvailable false', async () => {
    const network = stubNetwork();
    const env = elevenEnv();
    const ip = randomIp();
    expect(await speakTimes(5, { env, ip })).toEqual([200, 200, 200, 200, 200]);
    await isCapped(await speak({ env, ip }), true);

    const submitted = await lead({}, { env, ip });
    expect(submitted.status).toBe(200);
    expect(await submitted.json()).toMatchObject({ ok: true });

    expect(await speakTimes(5, { env, ip })).toEqual([200, 200, 200, 200, 200]); // 6th to 10th
    await isCapped(await speak({ env, ip }), false); // the 11th
    expect(network.eleven).toHaveLength(10);
  });

  it('can be earned before any reply is spoken: the cap is then 10 straight away', async () => {
    stubNetwork();
    const env = elevenEnv();
    const ip = randomIp();
    await lead({}, { env, ip });
    expect(await speakTimes(10, { env, ip })).toEqual(Array(10).fill(200));
    await isCapped(await speak({ env, ip }), false);
  });

  it('follows VOICE_TTS_BONUS', async () => {
    stubNetwork();
    const env = elevenEnv({ VOICE_TTS_PER_IP_PER_DAY: '1', VOICE_TTS_BONUS: '2' });
    const ip = randomIp();
    await speak({ env, ip });
    await lead({}, { env, ip });
    expect(await speakTimes(2, { env, ip })).toEqual([200, 200]);
    await isCapped(await speak({ env, ip }), false, 2);
  });

  it('is granted once: a second qualifying lead from the same address adds nothing', async () => {
    stubNetwork();
    const env = elevenEnv();
    const ip = randomIp();
    await lead({}, { env, ip });
    await lead({ name: 'Jane Again' }, { env, ip });
    expect(await fixedCount(env, await ttsBonusIpName(ip, env.RATE_SALT))).toBe(1);
    expect(await speakTimes(10, { env, ip })).toEqual(Array(10).fill(200));
    await isCapped(await speak({ env, ip }), false);
  });

  it('is for the address that left the details, not for everyone', async () => {
    stubNetwork();
    const env = elevenEnv();
    const visitor = randomIp();
    await lead({}, { env, ip: visitor });
    const other = randomIp();
    expect(await speakTimes(5, { env, ip: other })).toEqual(Array(5).fill(200));
    await isCapped(await speak({ env, ip: other }), true);
  });

  it.each([
    ['no email', { email: '' }],
    ['no email field at all', { email: undefined }],
  ])('is not granted for a lead with %s, though the lead itself is accepted', async (_label, overrides) => {
    stubNetwork();
    const env = elevenEnv();
    const ip = randomIp();
    await speakTimes(5, { env, ip });
    const submitted = await lead(overrides, { env, ip });
    expect(submitted.status).toBe(200);
    await isCapped(await speak({ env, ip }), true); // still available, still not granted
    expect(await fixedCount(env, await ttsBonusIpName(ip, env.RATE_SALT))).toBe(0);
  });

  it.each([
    ['an invalid email', { email: 'not-an-email' }],
    ['an email that is only spaces', { email: '   ' }],
    ['a phone number that is not ten digits', { phone: '555-1234' }],
    ['no name', { name: '' }],
  ])('is not granted for a lead that is refused for %s', async (_label, overrides) => {
    stubNetwork();
    const env = elevenEnv();
    const ip = randomIp();
    const submitted = await lead(overrides, { env, ip });
    expect(submitted.status).toBe(400);
    expect(await fixedCount(env, await ttsBonusIpName(ip, env.RATE_SALT))).toBe(0);
  });

  it('is not granted when the lead could not be delivered', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (new URL(String(input)).host === 'api.resend.com') return new Response('{}', { status: 500 });
      throw new Error('unexpected network call');
    });
    captureLogs();
    const env = elevenEnv();
    const ip = randomIp();
    const submitted = await lead({}, { env, ip, app: createApp({ lead: { email: { retryDelayMs: 0 } } }) });
    expect(submitted.status).toBe(502);
    expect(await fixedCount(env, await ttsBonusIpName(ip, env.RATE_SALT))).toBe(0);
  });

  it('takes the clock when the bonus is granted, after delivery, not when the lead arrived', async () => {
    // 23:30 EST on Nov 3 when the lead arrives; delivery takes "an hour", so by the time the bonus is granted it is
    // 00:30 on Nov 4. The bonus belongs to the new day, whose window is 23.5 hours long, not to the old one's 30 minutes.
    const arrived = new Date('2026-11-04T04:30:00Z');
    const delivered = new Date('2026-11-04T05:30:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(arrived);
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        if (new URL(String(input)).host !== 'api.resend.com') throw new Error('unexpected network call');
        vi.setSystemTime(delivered); // the time passes while the email is being sent
        return new Response(JSON.stringify({ id: 'stub' }), { status: 200, headers: { 'content-type': 'application/json' } });
      });
      const windows: Array<{ name: string; windowSeconds: number }> = [];
      const real = testEnv().LIMITER;
      const recording = {
        getByName: (name: string) => {
          const stub = real.getByName(name);
          return {
            hit: (...args: Parameters<typeof stub.hit>) => {
              windows.push({ name, windowSeconds: args[1] });
              return stub.hit(...args);
            },
          };
        },
      };
      const submitted = await lead({}, { env: elevenEnv({ LIMITER: recording }), ip: randomIp() });
      expect(submitted.status).toBe(200);
      const grant = windows.find((entry) => entry.name.startsWith('ip:tts-bonus:'));
      expect(grant?.windowSeconds).toBe(secondsToEtMidnight(delivered)); // 84,600, not 1,800
      expect(secondsToEtMidnight(arrived)).toBe(1800); // (the two clocks really do differ)
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not recorded at all while the browser voice is in use (nothing to unlock)', async () => {
    stubNetwork();
    const env = elevenEnv({ VOICE_TTS: 'browser' });
    const ip = randomIp();
    expect((await lead({}, { env, ip })).status).toBe(200);
    expect(await fixedCount(env, await ttsBonusIpName(ip, env.RATE_SALT))).toBe(0);
  });

  it('never fails or slows the lead if the limiter is down: the lead is still delivered', async () => {
    const logs = captureLogs();
    const network = stubNetwork();
    const real = testEnv().LIMITER;
    const flaky = {
      getByName: (name: string) => {
        const stub = real.getByName(name);
        return {
          hit: (...args: Parameters<typeof stub.hit>) =>
            name.startsWith('ip:tts-bonus:') ? Promise.reject(new Error('do exploded')) : stub.hit(...args),
        };
      },
    };
    const submitted = await lead({}, { env: elevenEnv({ LIMITER: flaky }), ip: randomIp() });
    expect(submitted.status).toBe(200);
    expect(network.resend).toHaveLength(1);
    expect(logs.some((line) => line.includes('"event":"limiter_error"'))).toBe(true);
    expect(logs.join('\n')).not.toContain('exploded');
  });
});

describe('a reply that is not delivered does not use up the allowance', () => {
  describe('and neither does it use up the day\'s character budget', () => {
    const budget = (env: ReturnType<typeof elevenEnv>) => fixedCount(env, globalTtsName());

    it.each([
      ['an error status', () => new Response('nope', { status: 500 })],
      ['a 200 with no body', () => new Response(null, { status: 200 })],
      ['a network error', () => { throw new TypeError('network down'); }],
    ])('gives the characters back when ElevenLabs answers with %s', async (_label, respond) => {
      captureLogs();
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => respond());
      const env = elevenEnv();
      expect((await speak({ env, ip: randomIp() }, 'Hello there.')).status).toBe(503);
      expect(await budget(env)).toBe(0);
    });

    it('gives them back after a timeout too', async () => {
      captureLogs();
      vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => undefined));
      const env = elevenEnv();
      expect((await speak({ env, ip: randomIp() }, 'Hello there.')).status).toBe(503);
      expect(await budget(env)).toBe(0);
    });

    it('gives them back when Aura fails', async () => {
      captureLogs();
      const stub = aiStub(() => {
        throw new Error('boom');
      });
      const env = testEnv({ AI: stub.ai, VOICE_TTS: 'aura' });
      expect((await speak({ env, ip: randomIp() }, 'Hello there.')).status).toBe(503);
      expect(await budget(env)).toBe(0);
    });

    it('keeps what earlier, delivered replies cost, and a failing provider cannot drain VOICE_DAILY_TTS_CHARS', async () => {
      captureLogs();
      const network = stubNetwork((n) => (n === 1 ? 200 : 500));
      const env = elevenEnv({ VOICE_DAILY_TTS_CHARS: '50' });
      expect((await speak({ env, ip: randomIp() }, 'Hello there.')).status).toBe(200); // 12 characters, delivered
      for (let i = 0; i < 10; i += 1) expect((await speak({ env, ip: randomIp() }, 'Hello there.')).status).toBe(503); // 120 more, not delivered
      expect(await budget(env)).toBe(12);
      expect(network.eleven).toHaveLength(11);
    });

    it('does not take back characters it never charged (a request the budget refused)', async () => {
      stubNetwork();
      const env = elevenEnv({ VOICE_DAILY_TTS_CHARS: '12' });
      expect((await speak({ env, ip: randomIp() }, 'Hello there.')).status).toBe(200);
      expect((await speak({ env, ip: randomIp() }, 'Hello there.')).status).toBe(503);
      expect(await budget(env)).toBe(12);
    });
  });

  describe('and a failure that straddles midnight credits the old day, not the new one', () => {
    it("leaves the new day's counters alone when the provider fails after the windows have turned over", async () => {
      captureLogs();
      const env = elevenEnv();
      const ip = randomIp();
      const spokenName = await ttsSpokenIpName(ip, env.RATE_SALT);
      // The provider call is where midnight passes: while it runs, both counters become a new day's, already holding
      // 3 spoken replies and 40 characters of that day's own.
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        for (const [name, count] of [[spokenName, 3], [globalTtsName(), 40]] as const) {
          await runInDurableObject(env.LIMITER.getByName(name), (_instance, ctx) => {
            ctx.storage.sql.exec('UPDATE counter SET reset_at = reset_at + 86400000, count = ? WHERE id = 0', count);
          });
        }
        return new Response('nope', { status: 500 });
      });
      expect((await speak({ env, ip }, 'Hello there.')).status).toBe(503);
      expect(await fixedCount(env, spokenName)).toBe(3);
      expect(await fixedCount(env, globalTtsName())).toBe(40);
    });
  });

  describe('and a refund that cannot be made is reported, not swallowed', () => {
    it('logs limiter_error with where: "tts_refund" once for each refund that fails, and still answers 503 server', async () => {
      const logs = captureLogs();
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('nope', { status: 500 }));
      const real = testEnv().LIMITER;
      const noRefunds = {
        getByName: (name: string) => {
          const stub = real.getByName(name);
          return {
            hit: (...args: Parameters<typeof stub.hit>) => stub.hit(...args),
            peek: (...args: Parameters<typeof stub.peek>) => stub.peek(...args),
            refund: () => Promise.reject(new Error('do exploded')),
          };
        },
      };
      const res = await speak({ env: elevenEnv({ LIMITER: noRefunds }), ip: randomIp() });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
      const refundLines = logs.filter((line) => line.includes('"where":"tts_refund"')).map((line) => JSON.parse(line));
      expect(refundLines).toEqual([
        { event: 'limiter_error', where: 'tts_refund' }, // the spoken-reply slot
        { event: 'limiter_error', where: 'tts_refund' }, // and the characters
      ]);
      expect(logs.join('\n')).not.toContain('exploded');
    });
  });

  it('gives the slot back when ElevenLabs fails, so five good replies still fit afterwards', async () => {
    captureLogs();
    const network = stubNetwork((n) => (n <= 3 ? 500 : 200));
    const env = elevenEnv();
    const ip = randomIp();
    expect(await speakTimes(3, { env, ip })).toEqual([503, 503, 503]);
    expect(await fixedCount(env, await ttsSpokenIpName(ip, env.RATE_SALT))).toBe(0);
    expect(await speakTimes(5, { env, ip })).toEqual([200, 200, 200, 200, 200]);
    await isCapped(await speak({ env, ip }), true);
    expect(network.eleven).toHaveLength(8);
  });

  it('gives it back when the provider throws, times out, or answers with no body', async () => {
    captureLogs();
    const env = elevenEnv();
    const ip = randomIp();
    const spoken = async () => fixedCount(env, await ttsSpokenIpName(ip, env.RATE_SALT));

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new TypeError('network down');
    });
    expect((await speak({ env, ip })).status).toBe(503);
    expect(await spoken()).toBe(0);

    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => undefined));
    expect((await speak({ env, ip })).status).toBe(503); // times out after 200 ms
    expect(await spoken()).toBe(0);

    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 200 }));
    expect((await speak({ env, ip })).status).toBe(503);
    expect(await spoken()).toBe(0);
  });

  it('gives it back when Aura fails too', async () => {
    captureLogs();
    const stub = aiStub(() => {
      throw new Error('boom');
    });
    const env = testEnv({ AI: stub.ai, VOICE_TTS: 'aura' });
    const ip = randomIp();
    expect((await speak({ env, ip })).status).toBe(503);
    expect(await fixedCount(env, await ttsSpokenIpName(ip, env.RATE_SALT))).toBe(0);
  });

  it('gives it back when the day\'s character budget refuses the reply', async () => {
    stubNetwork();
    const env = elevenEnv({ VOICE_DAILY_TTS_CHARS: '12' });
    const ip = randomIp();
    expect((await speak({ env, ip }, 'Hello there.')).status).toBe(200);
    const refused = await speak({ env, ip }, 'Hello there.');
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: 'voice_unavailable', reason: 'budget' });
    expect(await fixedCount(env, await ttsSpokenIpName(ip, env.RATE_SALT))).toBe(1); // only the one that was spoken
  });

  it('gives it back when the limiter fails in between, and answers 503 reason "server"', async () => {
    captureLogs();
    stubNetwork();
    const real = testEnv().LIMITER;
    const flaky = {
      getByName: (name: string) => {
        const stub = real.getByName(name);
        return {
          hit: (...args: Parameters<typeof stub.hit>) => (name.startsWith('global:tts:') ? Promise.reject(new Error('do exploded')) : stub.hit(...args)),
          peek: (...args: Parameters<typeof stub.peek>) => stub.peek(...args),
          refund: (...args: Parameters<typeof stub.refund>) => stub.refund(...args),
        };
      },
    };
    const env = elevenEnv({ LIMITER: flaky });
    const ip = randomIp();
    const res = await speak({ env, ip });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
    expect(await fixedCount(elevenEnv(), await ttsSpokenIpName(ip, env.RATE_SALT))).toBe(0);
  });
});

describe('reserving a slot is atomic', () => {
  it('lets exactly five of eight simultaneous requests through, and calls the provider five times', async () => {
    const network = stubNetwork();
    const env = elevenEnv();
    const ip = randomIp();
    const results = await Promise.all(Array.from({ length: 8 }, () => speak({ env, ip })));
    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429, 429]);
    expect(network.eleven).toHaveLength(5);
  });
});

describe('the allowance starts over with the Eastern-time day', () => {
  const midday = new Date('2026-07-04T15:00:00Z'); // 11:00 EDT: thirteen hours to go

  it('sizes the window to the time left in the day: the counter ends at Eastern midnight and Retry-After says so', async () => {
    stubNetwork();
    const app = createApp({ voice: { retryDelayMs: 0, timeoutMs: 200, now: () => midday }, lead: { now: () => midday } });
    const env = elevenEnv({ VOICE_TTS_PER_IP_PER_DAY: '1' });
    const ip = randomIp();
    await speak({ env, ip, app });
    const capped = await speak({ env, ip, app });
    await isCapped(capped, true);
    const retryAfter = Number(capped.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThanOrEqual(13 * 3600 - 10);
    expect(retryAfter).toBeLessThanOrEqual(13 * 3600);

    const name = await ttsSpokenIpName(ip, env.RATE_SALT);
    const { resetAt } = await env.LIMITER.getByName(name).peek(0, 'fixed');
    expect(Math.abs(resetAt - (Date.now() + 13 * 3600 * 1000))).toBeLessThan(5000);
  });

  it('opens a fresh allowance, and a fresh bonus, once the counters\' windows have ended (no waiting: the end is set directly)', async () => {
    stubNetwork();
    const env = elevenEnv({ VOICE_TTS_PER_IP_PER_DAY: '1', VOICE_TTS_BONUS: '1' });
    const ip = randomIp();

    expect((await speak({ env, ip })).status).toBe(200);
    await isCapped(await speak({ env, ip }), true, 1);
    expect((await lead({}, { env, ip })).status).toBe(200);
    expect((await speak({ env, ip })).status).toBe(200); // the bonus reply
    await isCapped(await speak({ env, ip }), false, 1);

    // Midnight passes: both counters' windows end.
    await setWindowEnd(env, await ttsSpokenIpName(ip, env.RATE_SALT), Date.now() - 1000);
    await setWindowEnd(env, await ttsBonusIpName(ip, env.RATE_SALT), Date.now() - 1000);

    expect((await speak({ env, ip })).status).toBe(200); // a new day's reply
    await isCapped(await speak({ env, ip }), true, 1); // and the bonus can be earned again: bonusAvailable is true once more
  });
});

describe('the cap is configuration, not a leak', () => {
  it('shows nothing about other visitors or the counters in a refusal', async () => {
    stubNetwork();
    const env = elevenEnv({ VOICE_TTS_PER_IP_PER_DAY: '1' });
    const ip = randomIp();
    await speak({ env, ip });
    const capped = await speak({ env, ip });
    expect(Object.keys((await capped.json()) as object).sort()).toEqual(['bonus', 'bonusAvailable', 'error']);
  });

  it('keeps the address, the session and the key out of the logs', async () => {
    const logs = captureLogs();
    stubNetwork();
    const env = elevenEnv({ VOICE_TTS_PER_IP_PER_DAY: '1' });
    const ip = randomIp();
    await speak({ env, ip });
    await speak({ env, ip });
    await lead({}, { env, ip });
    const all = logs.join('\n');
    expect(all).not.toContain(ip);
    expect(all).not.toContain(session);
    expect(all).not.toContain(KEY);
  });
});
