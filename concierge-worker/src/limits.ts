import type { Env } from './env';
import { sha256Hex } from './hash';
import { ipBucketKey } from './ip';
import type { HitResult } from './limiter';

/**
 * `sliding` keeps a timestamp per hit (exact, bounded by the limit): right for per-client
 * counters. `fixed` keeps one counter row per window: right for big shared counters such
 * as the daily caps, where thousands of timestamp rows would be wasted writes.
 */
export type LimitMode = 'sliding' | 'fixed';

export interface LimitRule {
  limit: number;
  windowSeconds: number;
  mode?: LimitMode;
}

// Contract section 2.3.
export const CHAT_IP: LimitRule = { limit: 20, windowSeconds: 10 * 60 };
export const LEAD_IP: LimitRule = { limit: 3, windowSeconds: 60 * 60 };
export const CHAT_SESSION: LimitRule = { limit: 40, windowSeconds: 24 * 60 * 60 };
export const DAY_SECONDS = 24 * 60 * 60;

/** Leads accepted per Eastern-time day across all visitors (Resend's free tier sends 100 a day). */
export const LEAD_DAILY_LIMIT = 100;

/** The daily model-call cap, as a fixed-window rule. */
export const llmDailyRule = (cap: number): LimitRule => ({ limit: cap, windowSeconds: DAY_SECONDS, mode: 'fixed' });

/** The daily lead cap, as a fixed-window rule. */
export const LEAD_DAILY: LimitRule = { limit: LEAD_DAILY_LIMIT, windowSeconds: DAY_SECONDS, mode: 'fixed' };

/**
 * Messages after which Turnstile is required: the 11th message, counting either the session's
 * messages or the address's messages (so rotating session ids does not dodge it).
 */
export const TURNSTILE_AFTER_MESSAGES = 10;

/**
 * Durable Object names. Addresses are reduced to their bucket (IPv6 to its /64) and hashed
 * with RATE_SALT, so no address is ever stored or visible in a DO listing.
 */
export const chatIpName = async (ip: string, salt: string): Promise<string> =>
  `ip:chat:${await sha256Hex(ipBucketKey(ip) + salt)}`;

export const leadIpName = async (ip: string, salt: string): Promise<string> =>
  `ip:lead:${await sha256Hex(ipBucketKey(ip) + salt)}`;

export const sessionName = (sessionId: string): string => `session:${sessionId}`;

const etDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar day (YYYY-MM-DD) in America/New_York, so the daily caps roll over at Eastern midnight. */
export const etDay = (now: Date = new Date()): string => etDayFormat.format(now);

export const globalName = (now: Date = new Date()): string => `global:${etDay(now)}`;

export const globalLeadName = (now: Date = new Date()): string => `global:lead:${etDay(now)}`;

export const hitLimiter = (env: Env, name: string, rule: LimitRule): Promise<HitResult> =>
  env.LIMITER.getByName(name).hit(rule.limit, rule.windowSeconds, rule.mode ?? 'sliding');
