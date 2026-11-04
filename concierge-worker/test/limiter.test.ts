import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/hash';
import {
  CHAT_IP,
  CHAT_SESSION,
  LEAD_IP,
  STT_IP,
  TTS_IP,
  chargeLimiter,
  chatIpName,
  etDay,
  globalName,
  globalTtsName,
  globalVoiceName,
  hitLimiter,
  leadIpName,
  nextEtMidnight,
  peekLimiter,
  refundLimiter,
  secondsToEtMidnight,
  sessionName,
  sessionVoiceName,
  sttDailyRule,
  sttIpName,
  sttSessionRule,
  ttsBonusIpName,
  ttsDailyRule,
  ttsIpName,
  ttsSpokenIpName,
  untilMidnightRule,
} from '../src/limits';

const stubFor = (name: string) => env.LIMITER.getByName(name);
const uniqueName = (prefix: string) => `${prefix}:${crypto.randomUUID()}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Limiter.hit', () => {
  it('allows exactly `limit` hits in the window, then denies the next one', async () => {
    const stub = stubFor(uniqueName('ip:chat'));
    for (let i = 1; i <= 20; i += 1) {
      const result = await stub.hit(20, 600);
      expect(result.allowed, `hit ${i}`).toBe(true);
      expect(result.count).toBe(i);
    }
    const denied = await stub.hit(20, 600);
    expect(denied.allowed).toBe(false);
    expect(denied.count).toBe(20);
  });

  it('does not count denied hits, so a blocked caller does not extend its own block', async () => {
    const stub = stubFor(uniqueName('session'));
    await stub.hit(2, 600);
    await stub.hit(2, 600);
    for (let i = 0; i < 5; i += 1) await stub.hit(2, 600);
    const state = await runInDurableObject(stub, (_instance, ctx) =>
      ctx.storage.sql.exec<{ c: number }>('SELECT COUNT(*) AS c FROM hits').one().c,
    );
    expect(state).toBe(2);
  });

  it('keeps separate ids independent', async () => {
    const a = stubFor(uniqueName('ip:chat'));
    const b = stubFor(uniqueName('ip:chat'));
    for (let i = 0; i < 3; i += 1) await a.hit(3, 600);
    expect((await a.hit(3, 600)).allowed).toBe(false);
    const fresh = await b.hit(3, 600);
    expect(fresh).toMatchObject({ allowed: true, count: 1 });
  });

  it('reports resetAt as the moment the oldest hit leaves the window', async () => {
    const stub = stubFor(uniqueName('ip:lead'));
    const before = Date.now();
    const first = await stub.hit(3, 3600);
    const after = Date.now();
    expect(first.resetAt).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(first.resetAt).toBeLessThanOrEqual(after + 3_600_000);
    const second = await stub.hit(3, 3600);
    expect(second.resetAt).toBe(first.resetAt); // still keyed to the oldest hit
  });

  it('allows hits again once the window has passed', async () => {
    const stub = stubFor(uniqueName('ip:chat'));
    expect((await stub.hit(1, 1)).allowed).toBe(true);
    expect((await stub.hit(1, 1)).allowed).toBe(false);
    await sleep(1150);
    const again = await stub.hit(1, 1);
    expect(again).toMatchObject({ allowed: true, count: 1 });
  });

  it('is atomic under concurrent callers', async () => {
    const stub = stubFor(uniqueName('global'));
    const results = await Promise.all(Array.from({ length: 30 }, () => stub.hit(20, 600)));
    expect(results.filter((r) => r.allowed)).toHaveLength(20);
    expect(results.filter((r) => !r.allowed)).toHaveLength(10);
  });

  it('treats a limit of zero or less as "always deny"', async () => {
    const stub = stubFor(uniqueName('ip:chat'));
    expect((await stub.hit(0, 60)).allowed).toBe(false);
    expect((await stub.hit(-5, 60)).allowed).toBe(false);
  });
});

describe('Limiter cleanup alarm', () => {
  it('schedules an alarm when the first hit lands', async () => {
    const stub = stubFor(uniqueName('ip:chat'));
    await stub.hit(5, 600);
    const alarm = await runInDurableObject(stub, (_i, ctx) => ctx.storage.getAlarm());
    expect(alarm).not.toBeNull();
    expect(alarm!).toBeGreaterThan(Date.now() + 599_000);
  });

  it('keeps data (and reschedules) if the alarm fires while hits are still inside the window', async () => {
    const stub = stubFor(uniqueName('ip:chat'));
    await stub.hit(5, 600);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await stub.hit(5, 600)).count).toBe(2);
    const alarm = await runInDurableObject(stub, (_i, ctx) => ctx.storage.getAlarm());
    expect(alarm).not.toBeNull();
  });

  it('deletes everything once the window has fully passed, and the object still works afterwards', async () => {
    const stub = stubFor(uniqueName('ip:chat'));
    await stub.hit(5, 1);
    await sleep(1150);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const tables = await runInDurableObject(stub, (_i, ctx) =>
      ctx.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hits'")
        .toArray(),
    );
    expect(tables).toHaveLength(0);
    expect(await runInDurableObject(stub, (_i, ctx) => ctx.storage.getAlarm())).toBeNull();
    // The in-memory instance outlives deleteAll(), so the schema must be recreated lazily.
    expect(await stub.hit(5, 1)).toMatchObject({ allowed: true, count: 1 });
  });
});

describe('Limiter.end (abuse cutoff)', () => {
  it('makes every later hit report ended, even with plenty of headroom', async () => {
    const stub = stubFor(uniqueName('session'));
    await stub.hit(40, 86400);
    await stub.end(86400);
    const result = await stub.hit(40, 86400);
    expect(result).toMatchObject({ allowed: false, ended: true });
  });

  it('only ends the session it was called on', async () => {
    const a = stubFor(uniqueName('session'));
    const b = stubFor(uniqueName('session'));
    await a.end(86400);
    expect(await b.hit(40, 86400)).toMatchObject({ allowed: true });
    expect((await b.hit(40, 86400)).ended).toBeUndefined();
  });

  it('expires after its ttl', async () => {
    const stub = stubFor(uniqueName('session'));
    await stub.end(1);
    expect((await stub.hit(40, 60)).ended).toBe(true);
    await sleep(1150);
    expect(await stub.hit(40, 60)).toMatchObject({ allowed: true });
  });

  it('survives the cleanup alarm until the ttl is over', async () => {
    const stub = stubFor(uniqueName('session'));
    await stub.end(600);
    await runDurableObjectAlarm(stub);
    expect((await stub.hit(40, 600)).ended).toBe(true);
  });
});

describe('Limiter fixed mode (one counter row)', () => {
  it('allows exactly `limit` hits per window, then denies, without counting the denied ones', async () => {
    const stub = stubFor(uniqueName('global'));
    for (let i = 1; i <= 3; i += 1) {
      expect(await stub.hit(3, 600, 'fixed'), `hit ${i}`).toMatchObject({ allowed: true, count: i });
    }
    for (let i = 0; i < 4; i += 1) {
      expect(await stub.hit(3, 600, 'fixed')).toMatchObject({ allowed: false, count: 3 });
    }
  });

  it('keeps the window fixed: resetAt is the first hit plus the window and later hits do not move it', async () => {
    const stub = stubFor(uniqueName('global'));
    const before = Date.now();
    const first = await stub.hit(5, 3600, 'fixed');
    const after = Date.now();
    expect(first.resetAt).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(first.resetAt).toBeLessThanOrEqual(after + 3_600_000);
    expect((await stub.hit(5, 3600, 'fixed')).resetAt).toBe(first.resetAt);
    expect((await stub.hit(5, 3600, 'fixed')).resetAt).toBe(first.resetAt);
  });

  it('starts a new window once the old one is over', async () => {
    const stub = stubFor(uniqueName('global'));
    const first = await stub.hit(1, 1, 'fixed');
    expect(first.allowed).toBe(true);
    expect((await stub.hit(1, 1, 'fixed')).allowed).toBe(false);
    await sleep(1150);
    const again = await stub.hit(1, 1, 'fixed');
    expect(again).toMatchObject({ allowed: true, count: 1 });
    expect(again.resetAt).toBeGreaterThan(first.resetAt);
  });

  it('stores one counter row however many hits arrive, and no timestamp rows', async () => {
    const stub = stubFor(uniqueName('global'));
    for (let i = 0; i < 40; i += 1) await stub.hit(1000, 600, 'fixed');
    const rows = await runInDurableObject(stub, (_i, ctx) => ({
      counter: ctx.storage.sql.exec<{ count: number; reset_at: number }>('SELECT count, reset_at FROM counter').toArray(),
      hits: ctx.storage.sql.exec<{ c: number }>('SELECT COUNT(*) AS c FROM hits').one().c,
    }));
    expect(rows.counter).toHaveLength(1);
    expect(rows.counter[0]!.count).toBe(40);
    expect(rows.hits).toBe(0);
  });

  it('is atomic under concurrent callers', async () => {
    const stub = stubFor(uniqueName('global'));
    const results = await Promise.all(Array.from({ length: 30 }, () => stub.hit(20, 600, 'fixed')));
    expect(results.filter((r) => r.allowed)).toHaveLength(20);
    expect(results.filter((r) => !r.allowed)).toHaveLength(10);
  });

  it('treats a limit of zero or less as "always deny" and writes nothing', async () => {
    const stub = stubFor(uniqueName('global'));
    expect((await stub.hit(0, 60, 'fixed')).allowed).toBe(false);
    expect((await stub.hit(-1, 60, 'fixed')).allowed).toBe(false);
    const count = await runInDurableObject(stub, (_i, ctx) =>
      ctx.storage.sql.exec<{ c: number }>('SELECT COUNT(*) AS c FROM counter').one().c,
    );
    expect(count).toBe(0);
  });

  it('keeps separate ids independent', async () => {
    const a = stubFor(uniqueName('global'));
    const b = stubFor(uniqueName('global'));
    await a.hit(1, 600, 'fixed');
    expect((await a.hit(1, 600, 'fixed')).allowed).toBe(false);
    expect((await b.hit(1, 600, 'fixed')).allowed).toBe(true);
  });

  it('defaults to sliding mode when no mode is given', async () => {
    const stub = stubFor(uniqueName('ip:chat'));
    await stub.hit(5, 600);
    const rows = await runInDurableObject(stub, (_i, ctx) => ({
      hits: ctx.storage.sql.exec<{ c: number }>('SELECT COUNT(*) AS c FROM hits').one().c,
      counter: ctx.storage.sql.exec<{ c: number }>('SELECT COUNT(*) AS c FROM counter').one().c,
    }));
    expect(rows).toEqual({ hits: 1, counter: 0 });
  });

  it('works with end(): an ended id reports ended in fixed mode too', async () => {
    const stub = stubFor(uniqueName('session'));
    await stub.hit(10, 600, 'fixed');
    await stub.end(600);
    expect(await stub.hit(10, 600, 'fixed')).toMatchObject({ allowed: false, ended: true });
  });

  it('is cleaned up by the alarm only after the window is over', async () => {
    const live = stubFor(uniqueName('global'));
    await live.hit(5, 600, 'fixed');
    expect(await runDurableObjectAlarm(live)).toBe(true);
    expect((await live.hit(5, 600, 'fixed')).count).toBe(2); // still inside the window: data kept
    expect(await runInDurableObject(live, (_i, ctx) => ctx.storage.getAlarm())).not.toBeNull();

    const done = stubFor(uniqueName('global'));
    await done.hit(5, 1, 'fixed');
    await sleep(1150);
    expect(await runDurableObjectAlarm(done)).toBe(true);
    const tables = await runInDurableObject(done, (_i, ctx) =>
      ctx.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'counter'").toArray(),
    );
    expect(tables).toHaveLength(0);
    expect(await done.hit(5, 1, 'fixed')).toMatchObject({ allowed: true, count: 1 }); // and it still works
  });
});

describe('Limiter schema', () => {
  it('indexes the sliding-window timestamps', async () => {
    const stub = stubFor(uniqueName('ip:chat'));
    await stub.hit(5, 600);
    const indexes = await runInDurableObject(stub, (_i, ctx) =>
      ctx.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'hits_ts'").toArray(),
    );
    expect(indexes).toHaveLength(1);
  });

  it('creates its tables once per object lifetime, not on every hit', async () => {
    const stub = stubFor(uniqueName('ip:chat'));
    await stub.hit(50, 600); // first call creates the schema
    const statements = await runInDurableObject(stub, async (instance, ctx) => {
      const seen: string[] = [];
      const sql = ctx.storage.sql;
      const original = sql.exec.bind(sql);
      sql.exec = ((query: string, ...bindings: unknown[]) => {
        seen.push(query);
        return original(query, ...(bindings as never[]));
      }) as typeof sql.exec;
      try {
        await instance.hit(50, 600);
        await instance.hit(50, 600);
        await instance.hit(50, 600, 'fixed');
      } finally {
        sql.exec = original;
      }
      return seen;
    });
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter((q) => /^\s*CREATE\b/i.test(q))).toEqual([]);
  });

  it('creates the tables again after the cleanup alarm wipes them', async () => {
    const stub = stubFor(uniqueName('ip:chat'));
    await stub.hit(5, 1);
    await sleep(1150);
    await runDurableObjectAlarm(stub); // deleteAll() drops the tables and resets the flag
    expect(await stub.hit(5, 1)).toMatchObject({ allowed: true, count: 1 });
    expect(await stub.hit(5, 1, 'fixed')).toMatchObject({ allowed: true, count: 1 });
  });
});

describe('sha256Hex', () => {
  it('matches the standard test vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('limiter ids and rules', () => {
  const SALT = 'test-salt';

  it('hashes the ip with the salt into 64 hex characters', async () => {
    const name = await chatIpName('203.0.113.7', SALT);
    expect(name).toMatch(/^ip:chat:[0-9a-f]{64}$/);
    expect(name).not.toContain('203.0.113.7');
    expect(name.slice('ip:chat:'.length)).toBe(await sha256Hex('203.0.113.7' + SALT));
  });

  it('uses distinct buckets for chat and lead, for different ips and for different salts', async () => {
    const chat = await chatIpName('203.0.113.7', SALT);
    const lead = await leadIpName('203.0.113.7', SALT);
    expect(lead).toMatch(/^ip:lead:[0-9a-f]{64}$/);
    expect(lead.slice('ip:lead:'.length)).toBe(chat.slice('ip:chat:'.length));
    expect(await chatIpName('203.0.113.8', SALT)).not.toBe(chat);
    expect(await chatIpName('203.0.113.7', 'other')).not.toBe(chat);
  });

  it('names the session bucket after the session id', () => {
    expect(sessionName('abc-123')).toBe('session:abc-123');
  });

  it('keys the global bucket on the America/New_York calendar day', () => {
    // 02:00 UTC on Nov 4 is still the evening of Nov 3 in New York (EST, UTC-5).
    expect(etDay(new Date('2026-11-04T02:00:00Z'))).toBe('2026-11-03');
    // 03:30 UTC on Jul 4 is 23:30 on Jul 3 in New York (EDT, UTC-4).
    expect(globalName(new Date('2026-07-04T03:30:00Z'))).toBe('global:2026-07-03');
    expect(etDay(new Date('2026-11-04T05:30:00Z'))).toBe('2026-11-04');
  });

  it('publishes the documented limits', () => {
    expect(CHAT_IP).toEqual({ limit: 20, windowSeconds: 600 });
    expect(LEAD_IP).toEqual({ limit: 3, windowSeconds: 3600 });
    expect(CHAT_SESSION).toEqual({ limit: 40, windowSeconds: 86400 });
  });
});

describe('Limiter fixed mode with a cost (seconds of audio, characters of speech)', () => {
  it('adds the cost to the counter and denies a hit that would pass the limit, without recording it', async () => {
    const stub = stubFor(uniqueName('global:voice'));
    expect(await stub.hit(9, 600, 'fixed', 5)).toMatchObject({ allowed: true, count: 5 });
    expect(await stub.hit(9, 600, 'fixed', 5)).toMatchObject({ allowed: false, count: 5 }); // 5 + 5 > 9
    expect(await stub.hit(9, 600, 'fixed', 4)).toMatchObject({ allowed: true, count: 9 }); // exactly the limit is allowed
    expect(await stub.hit(9, 600, 'fixed', 1)).toMatchObject({ allowed: false, count: 9 });
  });

  it('denies a single cost larger than the whole limit, even on a fresh counter', async () => {
    const stub = stubFor(uniqueName('global:voice'));
    expect(await stub.hit(9, 600, 'fixed', 10)).toMatchObject({ allowed: false, count: 0 });
    expect(await stub.hit(9, 600, 'fixed', 9)).toMatchObject({ allowed: true, count: 9 }); // and the denial left nothing behind
  });

  it('defaults to a cost of 1, so existing callers are unchanged', async () => {
    const stub = stubFor(uniqueName('global'));
    expect(await stub.hit(3, 600, 'fixed')).toMatchObject({ count: 1 });
    expect(await stub.hit(3, 600, 'fixed', 1)).toMatchObject({ count: 2 });
  });

  it.each([0, -4, Number.NaN, Number.POSITIVE_INFINITY])('treats a cost of %s as 1', async (cost) => {
    const stub = stubFor(uniqueName('global'));
    expect(await stub.hit(5, 600, 'fixed', cost)).toMatchObject({ allowed: true, count: 1 });
  });

  it('rounds a fractional cost down to whole units', async () => {
    const stub = stubFor(uniqueName('global'));
    expect(await stub.hit(50, 600, 'fixed', 2.9)).toMatchObject({ count: 2 });
  });

  it('keeps the window fixed: a costly hit does not move resetAt', async () => {
    const stub = stubFor(uniqueName('global:voice'));
    const first = await stub.hit(100, 3600, 'fixed', 30);
    expect((await stub.hit(100, 3600, 'fixed', 30)).resetAt).toBe(first.resetAt);
  });

  it('is atomic under concurrent callers', async () => {
    const stub = stubFor(uniqueName('global:voice'));
    const results = await Promise.all(Array.from({ length: 12 }, () => stub.hit(50, 600, 'fixed', 10)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(Math.max(...results.map((r) => r.count))).toBe(50);
  });

  it('ignores the cost in sliding mode (one timestamp per hit)', async () => {
    const stub = stubFor(uniqueName('ip:stt'));
    expect(await stub.hit(3, 600, 'sliding', 50)).toMatchObject({ allowed: true, count: 1 });
  });

  it('still reports an ended id as ended', async () => {
    const stub = stubFor(uniqueName('session'));
    await stub.end(600);
    expect(await stub.hit(10, 600, 'fixed', 3)).toMatchObject({ allowed: false, ended: true });
  });
});

describe('voice limiter ids and rules', () => {
  const SALT = 'test-salt';

  it('puts speech-to-text and text-to-speech addresses in their own hashed buckets', async () => {
    const chat = await chatIpName('203.0.113.7', SALT);
    const stt = await sttIpName('203.0.113.7', SALT);
    const tts = await ttsIpName('203.0.113.7', SALT);
    expect(stt).toMatch(/^ip:stt:[0-9a-f]{64}$/);
    expect(tts).toMatch(/^ip:tts:[0-9a-f]{64}$/);
    expect(stt).not.toContain('203.0.113.7');
    expect(stt.slice('ip:stt:'.length)).toBe(chat.slice('ip:chat:'.length)); // same hash, different namespace
    expect(tts.slice('ip:tts:'.length)).toBe(chat.slice('ip:chat:'.length));
    expect(await sttIpName('203.0.113.8', SALT)).not.toBe(stt);
  });

  it('reduces an IPv6 address to its /64 for the voice buckets too', async () => {
    expect(await sttIpName('2001:db8:1:2:aaaa::1', SALT)).toBe(await sttIpName('2001:db8:1:2:bbbb::9', SALT));
    expect(await ttsIpName('2001:db8:1:2:aaaa::1', SALT)).not.toBe(await ttsIpName('2001:db8:1:3:aaaa::1', SALT));
  });

  it('names the per-session audio counter after the session, apart from the message counter', () => {
    expect(sessionVoiceName('abc-123')).toBe('session-voice:abc-123');
    expect(sessionVoiceName('abc-123')).not.toBe(sessionName('abc-123'));
  });

  it('keys the daily voice counters on the America/New_York calendar day', () => {
    expect(globalVoiceName(new Date('2026-11-04T02:00:00Z'))).toBe('global:voice:2026-11-03');
    expect(globalTtsName(new Date('2026-11-04T02:00:00Z'))).toBe('global:tts:2026-11-03');
    expect(globalVoiceName(new Date('2026-11-04T05:30:00Z'))).toBe('global:voice:2026-11-04');
  });

  it('publishes the contracted limits', () => {
    expect(STT_IP).toEqual({ limit: 30, windowSeconds: 600 });
    expect(TTS_IP).toEqual({ limit: 30, windowSeconds: 600 });
    expect(sttDailyRule(9000)).toEqual({ limit: 9000, windowSeconds: 86400, mode: 'fixed' });
    expect(sttSessionRule(180)).toEqual({ limit: 180, windowSeconds: 86400, mode: 'fixed' });
    expect(ttsDailyRule(20000)).toEqual({ limit: 20000, windowSeconds: 86400, mode: 'fixed' });
  });
});

describe('Limiter.peek (a read that records nothing)', () => {
  it('reports the count without adding to it', async () => {
    const stub = stubFor(uniqueName('session'));
    expect(await stub.peek(600)).toMatchObject({ count: 0, ended: false });
    await stub.hit(40, 600);
    await stub.hit(40, 600);
    expect(await stub.peek(600)).toMatchObject({ count: 2, ended: false });
    expect(await stub.peek(600)).toMatchObject({ count: 2, ended: false });
    expect((await stub.hit(40, 600)).count).toBe(3); // the peeks did not count
  });

  it('counts only the hits inside the window it is asked about', async () => {
    const stub = stubFor(uniqueName('session'));
    await stub.hit(5, 1);
    await sleep(1150);
    expect((await stub.peek(1)).count).toBe(0);
    expect((await stub.peek(600)).count).toBe(1);
  });

  it('reports an ended id as ended, and as not ended once the cutoff has passed', async () => {
    const stub = stubFor(uniqueName('session'));
    await stub.hit(40, 600);
    await stub.end(1);
    expect(await stub.peek(600)).toMatchObject({ count: 1, ended: true });
    await sleep(1150);
    expect((await stub.peek(600)).ended).toBe(false);
  });

  it('reads a fixed counter too, and a spent fixed window as zero', async () => {
    const stub = stubFor(uniqueName('global:voice'));
    await stub.hit(10, 600, 'fixed', 4);
    expect(await stub.peek(600, 'fixed')).toMatchObject({ count: 4, ended: false });
    expect(await stub.peek(600, 'fixed')).toMatchObject({ count: 4, ended: false });
    const spent = stubFor(uniqueName('global:voice'));
    await spent.hit(10, 1, 'fixed', 4);
    await sleep(1150);
    expect((await spent.peek(1, 'fixed')).count).toBe(0);
  });

  describe('resetAt, for a Retry-After header', () => {
    it('is when the oldest hit leaves the window, the same moment hit() reports', async () => {
      const stub = stubFor(uniqueName('session'));
      const first = await stub.hit(40, 3600);
      await stub.hit(40, 3600);
      expect((await stub.peek(3600)).resetAt).toBe(first.resetAt);
    });

    it('is when the fixed window ends', async () => {
      const stub = stubFor(uniqueName('global:voice'));
      const first = await stub.hit(100, 3600, 'fixed', 5);
      expect((await stub.peek(3600, 'fixed')).resetAt).toBe(first.resetAt);
    });

    it('is when the cutoff expires for an ended id', async () => {
      const stub = stubFor(uniqueName('session'));
      const before = Date.now();
      await stub.end(120);
      const { resetAt } = await stub.peek(600);
      expect(resetAt).toBeGreaterThanOrEqual(before + 120_000);
      expect(resetAt).toBeLessThanOrEqual(Date.now() + 120_000);
    });

    it('is "now" when there is nothing to wait for', async () => {
      const stub = stubFor(uniqueName('session'));
      const before = Date.now();
      const { resetAt } = await stub.peek(600);
      expect(resetAt).toBeGreaterThanOrEqual(before);
      expect(resetAt).toBeLessThanOrEqual(Date.now());
    });
  });

  it('leaves nothing behind on an id that was never used: no tables and no cleanup alarm', async () => {
    const stub = stubFor(uniqueName('session'));
    expect(await stub.peek(600)).toMatchObject({ count: 0, ended: false });
    const state = await runInDurableObject(stub, async (_instance, ctx) => ({
      tables: ctx.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('hits', 'counter', 'meta')")
        .toArray(),
      alarm: await ctx.storage.getAlarm(),
    }));
    expect(state).toEqual({ tables: [], alarm: null });
  });

  it('still answers after the cleanup alarm has deleted everything', async () => {
    const stub = stubFor(uniqueName('session'));
    await stub.hit(5, 1);
    await sleep(1150);
    await runDurableObjectAlarm(stub);
    expect(await stub.peek(1)).toMatchObject({ count: 0, ended: false });
    expect(await stub.hit(5, 1)).toMatchObject({ allowed: true, count: 1 }); // and it still works afterwards
  });
});

describe('chargeLimiter (spending that has already happened)', () => {
  const rule = { limit: 10, windowSeconds: 600, mode: 'fixed' } as const;

  it('adds the cost even when it takes the counter past the limit, which hitLimiter would have refused', async () => {
    const name = uniqueName('global:voice');
    expect(await hitLimiter(env, name, rule, 8)).toMatchObject({ allowed: true, count: 8 });
    expect(await hitLimiter(env, name, rule, 5)).toMatchObject({ allowed: false, count: 8 });
    expect(await chargeLimiter(env, name, rule, 5)).toMatchObject({ allowed: true, count: 13 });
    expect(await chargeLimiter(env, name, rule, 1380)).toMatchObject({ count: 1393 });
    expect((await peekLimiter(env, name, rule)).count).toBe(1393); // visible to the check that runs before the next call
    expect((await hitLimiter(env, name, rule, 1)).allowed).toBe(false);
  });

  it('starts a window like any hit, and rounds the cost like any hit', async () => {
    const name = uniqueName('global:voice');
    const first = await chargeLimiter(env, name, rule, 2.9);
    expect(first.count).toBe(2);
    expect(first.resetAt).toBeGreaterThan(Date.now());
    expect((await chargeLimiter(env, name, rule, 0)).count).toBe(3); // a cost below 1 counts as 1
  });
});

describe('Eastern-midnight windows for the per-visitor daily counters', () => {
  it.each([
    ['an ordinary winter day (10:00 EST)', '2026-11-03T15:00:00Z', '2026-11-04T05:00:00.000Z'],
    ['a summer day (11:00 EDT)', '2026-07-04T15:00:00Z', '2026-07-05T04:00:00.000Z'],
    ['00:30 on the 25-hour day clocks go back (Nov 1 2026)', '2026-11-01T04:30:00Z', '2026-11-02T05:00:00.000Z'],
    ['a millisecond before the end of that day', '2026-11-02T04:59:59.999Z', '2026-11-02T05:00:00.000Z'],
    ['00:30 on the 23-hour day clocks go forward (Mar 8 2026)', '2026-03-08T05:30:00Z', '2026-03-09T04:00:00.000Z'],
    ['exactly midnight, which already belongs to the new day', '2026-11-04T05:00:00Z', '2026-11-05T05:00:00.000Z'],
  ])('nextEtMidnight: %s', (_label, now, expected) => {
    expect(new Date(nextEtMidnight(new Date(now))).toISOString()).toBe(expected);
  });

  it('is always after "now" and lands on the first instant of a new Eastern date', () => {
    for (let hours = 0; hours < 24 * 400; hours += 7) {
      const now = new Date(Date.UTC(2026, 0, 1) + hours * 3_600_000 + 12_345);
      const next = nextEtMidnight(now);
      expect(next).toBeGreaterThan(now.getTime());
      expect(etDay(new Date(next))).not.toBe(etDay(now));
      expect(etDay(new Date(next - 1000))).toBe(etDay(now));
    }
  });

  it('secondsToEtMidnight counts whole seconds, rounded up, and is never below 1', () => {
    expect(secondsToEtMidnight(new Date('2026-11-03T15:00:00Z'))).toBe(14 * 3600);
    expect(secondsToEtMidnight(new Date('2026-11-04T04:59:59.100Z'))).toBe(1);
    expect(secondsToEtMidnight(new Date('2026-11-04T04:59:59.999Z'))).toBe(1);
    expect(secondsToEtMidnight(new Date('2026-11-01T04:30:00Z'))).toBe(25 * 3600 - 1800);
  });

  it('untilMidnightRule is a fixed-window rule that lasts until then', () => {
    expect(untilMidnightRule(5, new Date('2026-11-03T15:00:00Z'))).toEqual({ limit: 5, windowSeconds: 14 * 3600, mode: 'fixed' });
  });
});

describe('per-visitor spoken-reply counter names', () => {
  const SALT = 'test-salt';

  it('hash the address like the other per-address counters, in their own namespaces', async () => {
    const chat = await chatIpName('203.0.113.7', SALT);
    const spoken = await ttsSpokenIpName('203.0.113.7', SALT);
    const bonus = await ttsBonusIpName('203.0.113.7', SALT);
    expect(spoken).toMatch(/^ip:tts-spoken:[0-9a-f]{64}$/);
    expect(bonus).toMatch(/^ip:tts-bonus:[0-9a-f]{64}$/);
    expect(spoken).not.toContain('203.0.113.7');
    expect(spoken.slice('ip:tts-spoken:'.length)).toBe(chat.slice('ip:chat:'.length));
    expect(bonus.slice('ip:tts-bonus:'.length)).toBe(chat.slice('ip:chat:'.length));
    expect(spoken).not.toBe(await ttsIpName('203.0.113.7', SALT)); // the 30-per-10-minutes abuse bucket is another counter
  });

  it('share an IPv6 /64, as every address bucket does', async () => {
    expect(await ttsSpokenIpName('2001:db8:1:2:aaaa::1', SALT)).toBe(await ttsSpokenIpName('2001:db8:1:2:bbbb::9', SALT));
    expect(await ttsBonusIpName('2001:db8:1:2:aaaa::1', SALT)).not.toBe(await ttsBonusIpName('2001:db8:1:3:aaaa::1', SALT));
  });
});

describe('Limiter.refund (giving a reserved unit back to the window it came from)', () => {
  const rule = { limit: 10, windowSeconds: 600, mode: 'fixed' } as const;
  /** Rewrites the counter row the way a new window would: a different end time and (optionally) a count. */
  const setRow = (stub: ReturnType<typeof stubFor>, resetAt: number, count?: number) =>
    runInDurableObject(stub, (_instance, ctx) => {
      ctx.storage.sql.exec('UPDATE counter SET reset_at = ? WHERE id = 0', resetAt);
      if (count !== undefined) ctx.storage.sql.exec('UPDATE counter SET count = ? WHERE id = 0', count);
    });

  it('takes units back off a fixed counter, so they can be used again', async () => {
    const stub = stubFor(uniqueName('ip:tts-spoken'));
    const { resetAt } = await stub.hit(3, 600, 'fixed');
    await stub.hit(3, 600, 'fixed');
    await stub.hit(3, 600, 'fixed');
    expect((await stub.hit(3, 600, 'fixed')).allowed).toBe(false);
    expect(await stub.refund(1, resetAt)).toBe(2);
    expect((await stub.peek(600, 'fixed')).count).toBe(2);
    expect(await stub.hit(3, 600, 'fixed')).toMatchObject({ allowed: true, count: 3 });
  });

  it('never takes a counter below zero', async () => {
    const stub = stubFor(uniqueName('ip:tts-spoken'));
    const { resetAt } = await stub.hit(10, 600, 'fixed', 2);
    expect(await stub.refund(50, resetAt)).toBe(0);
    expect((await stub.peek(600, 'fixed')).count).toBe(0);
  });

  it.each([0, -3, Number.NaN, 2.9])('counts a refund of %s as whole units of at least 1', async (amount) => {
    const stub = stubFor(uniqueName('ip:tts-spoken'));
    const { resetAt } = await stub.hit(100, 600, 'fixed', 10);
    const expected = amount === 2.9 ? 8 : 9; // 2.9 rounds down to 2; the rest count as 1
    expect(await stub.refund(amount, resetAt)).toBe(expected);
  });

  describe('when the window has changed since the unit was reserved', () => {
    it('does nothing: a unit reserved yesterday is not credited to today (a call that straddled midnight)', async () => {
      const stub = stubFor(uniqueName('ip:tts-spoken'));
      const reserved = await stub.hit(5, 600, 'fixed'); // reserved in the window that ends at reserved.resetAt
      // The window ends and a new one begins, already holding three of its own units.
      await setRow(stub, reserved.resetAt + 86_400_000, 3);
      expect(await stub.refund(1, reserved.resetAt)).toBe(3); // reports the new window's count, untouched
      expect((await stub.peek(600, 'fixed')).count).toBe(3);
      expect(await stub.refund(1, reserved.resetAt + 86_400_000)).toBe(2); // refunding the window it is really in works
    });

    it('does nothing for a window that has already ended, whatever was expected', async () => {
      const stub = stubFor(uniqueName('ip:tts-spoken'));
      const { resetAt } = await stub.hit(5, 600, 'fixed', 3);
      await setRow(stub, Date.now() - 1000); // the window is over
      expect(await stub.refund(1, resetAt)).toBe(0);
      expect(await stub.hit(5, 600, 'fixed')).toMatchObject({ allowed: true, count: 1 }); // the next hit starts afresh
    });

    it('does nothing for a window that merely differs by a millisecond', async () => {
      const stub = stubFor(uniqueName('ip:tts-spoken'));
      const { resetAt } = await stub.hit(5, 600, 'fixed', 2);
      expect(await stub.refund(1, resetAt + 1)).toBe(2);
      expect(await stub.refund(1, resetAt - 1)).toBe(2);
    });
  });

  it('does nothing, and writes nothing, for an id with no live counter', async () => {
    const stub = stubFor(uniqueName('ip:tts-spoken'));
    expect(await stub.refund(1, Date.now() + 60_000)).toBe(0);
    const state = await runInDurableObject(stub, async (_instance, ctx) => ({
      tables: ctx.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('hits', 'counter', 'meta')")
        .toArray(),
      alarm: await ctx.storage.getAlarm(),
    }));
    expect(state).toEqual({ tables: [], alarm: null });
  });

  it('works through refundLimiter, and leaves the window where it was', async () => {
    const name = uniqueName('ip:tts-spoken');
    const first = await hitLimiter(env, name, rule, 4);
    await refundLimiter(env, name, 3, first.resetAt);
    expect((await peekLimiter(env, name, rule)).count).toBe(1);
    expect((await peekLimiter(env, name, rule)).resetAt).toBe(first.resetAt);
    await refundLimiter(env, name, 1, first.resetAt + 5); // the wrong window: no effect
    expect((await peekLimiter(env, name, rule)).count).toBe(1);
  });
});
