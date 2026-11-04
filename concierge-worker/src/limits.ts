import type { Env } from './env';
import { sha256Hex } from './hash';
import { ipBucketKey } from './ip';
import type { HitResult, PeekResult } from './limiter';

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

// Voice plan section 1: 30 recordings per address per 10 minutes. /tts gets the same limit, so a
// direct caller cannot burn the day's premium-voice budget alone (the widget asks for at most one
// reply at a time, so 30 is never reached by a real visitor).
export const STT_IP: LimitRule = { limit: 30, windowSeconds: 10 * 60 };
export const TTS_IP: LimitRule = { limit: 30, windowSeconds: 10 * 60 };
export const LEAD_IP: LimitRule = { limit: 3, windowSeconds: 60 * 60 };
export const CHAT_SESSION: LimitRule = { limit: 40, windowSeconds: 24 * 60 * 60 };
export const DAY_SECONDS = 24 * 60 * 60;

/** Leads accepted per Eastern-time day across all visitors (Resend's free tier sends 100 a day). */
export const LEAD_DAILY_LIMIT = 100;

/**
 * A cap on a shared or per-session total over 24 hours, as a fixed-window rule. Every daily cap is this
 * rule with a different limit; the names below say which cap a call site means. The voice budgets count
 * units (audio seconds, characters), so they are charged with a cost (see Limiter.hit, chargeLimiter).
 */
const fixedDayRule = (limit: number): LimitRule => ({ limit, windowSeconds: DAY_SECONDS, mode: 'fixed' });

/** The daily model-call cap. */
export const llmDailyRule = fixedDayRule;
/** Audio seconds of speech-to-text per Eastern-time day, all visitors. */
export const sttDailyRule = fixedDayRule;
/** Audio seconds of speech-to-text per chat session. */
export const sttSessionRule = fixedDayRule;
/** Characters of premium text-to-speech per Eastern-time day, all visitors. */
export const ttsDailyRule = fixedDayRule;

/** The daily lead cap. */
export const LEAD_DAILY: LimitRule = fixedDayRule(LEAD_DAILY_LIMIT);

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

export const sttIpName = async (ip: string, salt: string): Promise<string> =>
  `ip:stt:${await sha256Hex(ipBucketKey(ip) + salt)}`;

export const ttsIpName = async (ip: string, salt: string): Promise<string> =>
  `ip:tts:${await sha256Hex(ipBucketKey(ip) + salt)}`;

export const sessionName = (sessionId: string): string => `session:${sessionId}`;

/** Seconds of speech-to-text used by one chat session (a separate counter from its message count). */
export const sessionVoiceName = (sessionId: string): string => `session-voice:${sessionId}`;

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

export const globalVoiceName = (now: Date = new Date()): string => `global:voice:${etDay(now)}`;

export const globalTtsName = (now: Date = new Date()): string => `global:tts:${etDay(now)}`;

/** Reads a counter without recording a hit (see Limiter.peek). */
export const peekLimiter = (env: Env, name: string, rule: LimitRule): Promise<PeekResult> =>
  env.LIMITER.getByName(name).peek(rule.windowSeconds, rule.mode ?? 'sliding');

/** A Durable Object call failed. The route cannot enforce its limits, so it stops taking requests. */
export class LimiterError extends Error {
  override readonly name = 'LimiterError';
}

/** Runs a limiter call and turns any failure into a LimiterError, so routes handle one error type. */
export const viaLimiter = async <T>(work: Promise<T>): Promise<T> => {
  try {
    return await work;
  } catch {
    throw new LimiterError('limiter unavailable');
  }
};

/**
 * Runs a route's work and, if a limiter call inside it failed (see viaLimiter), logs `limiter_error` and
 * answers `fallback()` instead: a route that cannot enforce its limits stops taking requests. Any other
 * error passes through to the app's own handler.
 */
export const orLimiterDown = async (work: () => Promise<Response>, fallback: () => Response): Promise<Response> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof LimiterError) {
      console.error(JSON.stringify({ event: 'limiter_error' }));
      return fallback();
    }
    throw error;
  }
};

/** `cost` counts one call as several units (seconds, characters) in a fixed-window rule; see Limiter.hit. */
export const hitLimiter = (env: Env, name: string, rule: LimitRule, cost = 1): Promise<HitResult> =>
  env.LIMITER.getByName(name).hit(rule.limit, rule.windowSeconds, rule.mode ?? 'sliding', cost);

/**
 * Adds `cost` to a fixed-window counter whatever its limit. For spending that has already happened (a
 * model call that ran, and cost what it cost): a counter taken past its limit is the right record, and
 * the next request's check, which refuses once the count is at or over the limit, will see it.
 */
export const chargeLimiter = (env: Env, name: string, rule: LimitRule, cost: number): Promise<HitResult> =>
  hitLimiter(env, name, { ...rule, limit: Number.MAX_SAFE_INTEGER }, cost);
