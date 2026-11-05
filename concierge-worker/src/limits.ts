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

// Free website checker. Competitor scans are ordinary scans, so a visitor who grades three
// competitors alongside their own site uses four of the ten.
export const CHECKER_SCAN_IP: LimitRule = { limit: 10, windowSeconds: 10 * 60 };
export const CHECKER_SCAN_DAY_LIMIT = 30;
export const CHECKER_SIGNUP_IP: LimitRule = { limit: 5, windowSeconds: 60 * 60 };
export const CHECKER_REPORT_IP: LimitRule = { limit: 60, windowSeconds: 10 * 60 };
/** Real unlocks (lead, email, plan) per email address per hour: stops the form being used to mail someone else. */
export const CHECKER_EMAIL_HOURLY: LimitRule = { limit: 3, windowSeconds: 60 * 60 };
/** Action plans per Eastern-time day across all visitors (the CHECKER_DAILY_PLANS var). */
export const checkerPlanDailyRule = fixedDayRule;
/** Scans per Eastern-time day across all visitors (the CHECKER_DAILY_SCANS var). */
export const checkerDailyRule = fixedDayRule;

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

/** Spoken replies served to one address today: the per-visitor cap on the paid voice (see untilMidnightRule). */
export const ttsSpokenIpName = async (ip: string, salt: string): Promise<string> =>
  `ip:tts-spoken:${await sha256Hex(ipBucketKey(ip) + salt)}`;

/** Set to 1 once an address has earned today's bonus replies by leaving its contact details. */
export const ttsBonusIpName = async (ip: string, salt: string): Promise<string> =>
  `ip:tts-bonus:${await sha256Hex(ipBucketKey(ip) + salt)}`;

export const checkerScanIpName = async (ip: string, salt: string): Promise<string> =>
  `ip:checker-scan:${await sha256Hex(ipBucketKey(ip) + salt)}`;

/** Scans by one address today; the rule for it is untilMidnightRule(CHECKER_SCAN_DAY_LIMIT). */
export const checkerScanDayIpName = async (ip: string, salt: string): Promise<string> =>
  `ip:checker-scan-day:${await sha256Hex(ipBucketKey(ip) + salt)}`;

export const checkerSignupIpName = async (ip: string, salt: string): Promise<string> =>
  `ip:checker-signup:${await sha256Hex(ipBucketKey(ip) + salt)}`;

export const checkerReportIpName = async (ip: string, salt: string): Promise<string> =>
  `ip:checker-report:${await sha256Hex(ipBucketKey(ip) + salt)}`;

/** The lowercased address is hashed with the salt, so no address is stored or visible in a DO listing. */
export const checkerEmailName = async (email: string, salt: string): Promise<string> =>
  `email:checker:${await sha256Hex(email.trim().toLowerCase() + salt)}`;

/** One real unlock per scan per Eastern day; the rule for it is untilMidnightRule(1). */
export const checkerUnlockName = (scanId: string): string => `checker-unlock:${scanId.toLowerCase()}`;

/** One report email per scan and address per Eastern day; the rule for it is untilMidnightRule(1). */
export const checkerUnlockEmailName = async (scanId: string, email: string, salt: string): Promise<string> =>
  `checker-unlock-email:${await sha256Hex(`${scanId.toLowerCase()}:${email.trim().toLowerCase()}${salt}`)}`;

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

/**
 * The first instant (epoch ms, on a whole second) of the next Eastern-time calendar day. Found by search,
 * not arithmetic, because an Eastern day is 23 or 25 hours long twice a year.
 */
export const nextEtMidnight = (now: Date = new Date()): number => {
  const today = etDay(now);
  let lo = Math.floor(now.getTime() / 1000); // a second that is still today
  let hi = lo + 26 * 3600; // an Eastern day is at most 25 hours, so this is tomorrow
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (etDay(new Date(mid * 1000)) === today) lo = mid;
    else hi = mid;
  }
  return hi * 1000;
};

/** Whole seconds until Eastern midnight, rounded up, at least 1: a window length and a Retry-After value. */
export const secondsToEtMidnight = (now: Date = new Date()): number =>
  Math.max(1, Math.ceil((nextEtMidnight(now) - now.getTime()) / 1000));

/**
 * A fixed-window rule whose window ends at the next Eastern midnight, so a per-address daily counter starts
 * over with the day (the window opens at the first hit, with the time left in the day as its length).
 */
export const untilMidnightRule = (limit: number, now: Date = new Date()): LimitRule => ({
  limit,
  windowSeconds: secondsToEtMidnight(now),
  mode: 'fixed',
});

export const globalName = (now: Date = new Date()): string => `global:${etDay(now)}`;

export const globalLeadName = (now: Date = new Date()): string => `global:lead:${etDay(now)}`;

export const globalCheckerScanName = (now: Date = new Date()): string => `global:checker-scan:${etDay(now)}`;

export const globalCheckerPlanName = (now: Date = new Date()): string => `global:checker-plan:${etDay(now)}`;

export const globalVoiceName = (now: Date = new Date()): string => `global:voice:${etDay(now)}`;

export const globalTtsName = (now: Date = new Date()): string => `global:tts:${etDay(now)}`;

/** Reads a counter without recording a hit (see Limiter.peek). */
export const peekLimiter = (env: Env, name: string, rule: LimitRule): Promise<PeekResult> =>
  env.LIMITER.getByName(name).peek(rule.windowSeconds, rule.mode ?? 'sliding');

/**
 * Gives `cost` units back to a fixed counter, if its window still ends at `expectedResetAt`, the `resetAt` the
 * reserving hit returned (see Limiter.refund).
 */
export const refundLimiter = (env: Env, name: string, cost: number, expectedResetAt: number): Promise<number> =>
  env.LIMITER.getByName(name).refund(cost, expectedResetAt);

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
