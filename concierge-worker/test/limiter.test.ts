import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/hash';
import {
  CHAT_IP,
  CHAT_SESSION,
  LEAD_IP,
  chatIpName,
  etDay,
  globalName,
  leadIpName,
  sessionName,
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
