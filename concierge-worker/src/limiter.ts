import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

export interface HitResult {
  /** Whether this hit was counted. Denied hits are not recorded. */
  allowed: boolean;
  /** Hits currently inside the window, including this one when it was allowed. */
  count: number;
  /** Epoch ms when the window frees up: the oldest hit leaves (sliding), the window ends (fixed), or an ended session expires. */
  resetAt: number;
  /** Present and true only when the session was cut off with `end()`. */
  ended?: true;
}

export type HitMode = 'sliding' | 'fixed';

// Alarm runs a little after the last hit leaves the window, never before.
const CLEANUP_SLACK_MS = 1000;

/**
 * One counter per Durable Object id (see src/limits.ts for the ids), in one of two modes.
 *
 * sliding  A SQLite table of hit timestamps (indexed, pruned on every call), so the count is
 *          exact for any trailing window. Storage is bounded by the limit. Used for per-client
 *          counters, where the limits are small.
 * fixed    A single `{count, reset_at}` row: the window starts at the first hit and the counter
 *          resets when it ends. One row written per hit however large the limit, which is what
 *          the global daily caps need.
 *
 * Either way `hit()` does its read-check-write synchronously, which makes it atomic without
 * any locking, and an alarm deletes all state once the window has fully passed so idle ids
 * leave nothing behind.
 */
export class Limiter extends DurableObject<Env> {
  // Tables are created once per object lifetime, not on every call. deleteAll() (the cleanup
  // alarm) drops them while this instance can stay in memory, so alarm() clears the flag.
  #schemaReady = false;

  #ensureSchema(): void {
    if (this.#schemaReady) return;
    const sql = this.ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS hits (ts INTEGER NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS hits_ts ON hits(ts)');
    sql.exec('CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY CHECK (id = 0), count INTEGER NOT NULL, reset_at INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)');
    this.#schemaReady = true;
  }

  #getMeta(key: string): number | null {
    const rows = this.ctx.storage.sql.exec<{ v: number }>('SELECT v FROM meta WHERE k = ?', key).toArray();
    return rows[0]?.v ?? null;
  }

  #setMeta(key: string, value: number): void {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', key, value);
  }

  async #ensureAlarm(at: number): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(at);
  }

  /**
   * Records a hit if fewer than `limit` hits happened in the window. A limit of zero or less
   * always denies. `mode` defaults to a sliding window.
   */
  async hit(limit: number, windowSeconds: number, mode: HitMode = 'sliding'): Promise<HitResult> {
    const now = Date.now();
    const max = Number.isFinite(limit) ? Math.floor(limit) : 0;
    const seconds = Number.isFinite(windowSeconds) ? Math.floor(windowSeconds) : 1;
    const windowMs = Math.max(1, seconds) * 1000;

    this.#ensureSchema();
    const endedUntil = this.#getMeta('ended_until');
    const ended = endedUntil !== null && endedUntil > now;

    return mode === 'fixed' ? this.#hitFixed(now, max, windowMs, ended ? endedUntil : null) : this.#hitSliding(now, max, windowMs, ended ? endedUntil : null);
  }

  async #hitSliding(now: number, max: number, windowMs: number, endedUntil: number | null): Promise<HitResult> {
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM hits WHERE ts <= ?', now - windowMs);
    const { c, oldest } = sql
      .exec<{ c: number; oldest: number | null }>('SELECT COUNT(*) AS c, MIN(ts) AS oldest FROM hits')
      .one();

    if (endedUntil !== null) return { allowed: false, count: c, resetAt: endedUntil, ended: true };
    if (c >= max) return { allowed: false, count: c, resetAt: (oldest ?? now) + windowMs };

    sql.exec('INSERT INTO hits (ts) VALUES (?)', now);
    if (this.#getMeta('window_ms') !== windowMs) this.#setMeta('window_ms', windowMs);
    await this.#ensureAlarm((oldest ?? now) + windowMs + CLEANUP_SLACK_MS);
    return { allowed: true, count: c + 1, resetAt: (oldest ?? now) + windowMs };
  }

  async #hitFixed(now: number, max: number, windowMs: number, endedUntil: number | null): Promise<HitResult> {
    const sql = this.ctx.storage.sql;
    const row = sql.exec<{ count: number; reset_at: number }>('SELECT count, reset_at FROM counter WHERE id = 0').toArray()[0];
    const live = row !== undefined && row.reset_at > now;
    const count = live ? row.count : 0;
    const resetAt = live ? row.reset_at : now + windowMs;

    if (endedUntil !== null) return { allowed: false, count, resetAt: endedUntil, ended: true };
    if (count >= max) return { allowed: false, count, resetAt };

    sql.exec('INSERT OR REPLACE INTO counter (id, count, reset_at) VALUES (0, ?, ?)', count + 1, resetAt);
    await this.#ensureAlarm(resetAt + CLEANUP_SLACK_MS);
    return { allowed: true, count: count + 1, resetAt };
  }

  /** Cuts a session off: every later `hit()` reports `ended: true` until `ttlSeconds` pass. */
  async end(ttlSeconds: number): Promise<void> {
    const ttlMs = Math.max(1, Math.floor(Number.isFinite(ttlSeconds) ? ttlSeconds : 1)) * 1000;
    const until = Date.now() + ttlMs;
    this.#ensureSchema();
    this.#setMeta('ended_until', until);
    await this.#ensureAlarm(until + CLEANUP_SLACK_MS);
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    this.#ensureSchema();
    const sql = this.ctx.storage.sql;
    const windowMs = this.#getMeta('window_ms') ?? 0;
    sql.exec('DELETE FROM hits WHERE ts <= ?', now - windowMs);

    // Everything stays until the latest of: the newest sliding hit leaving its window, the
    // fixed window ending, and an ended session expiring.
    const { newest } = sql.exec<{ newest: number | null }>('SELECT MAX(ts) AS newest FROM hits').one();
    const counter = sql.exec<{ reset_at: number }>('SELECT reset_at FROM counter WHERE id = 0').toArray()[0];
    const endedUntil = this.#getMeta('ended_until');
    const freeAt = Math.max(newest === null ? 0 : newest + windowMs, counter?.reset_at ?? 0, endedUntil ?? 0);

    if (freeAt > now) {
      await this.ctx.storage.setAlarm(freeAt + CLEANUP_SLACK_MS);
      return;
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.#schemaReady = false; // the tables are gone; the next call recreates them
  }
}
