import { buildLeadEmail, sendViaResend, type SendOptions } from './email';
import { leadquikUrl, turnstileSecret, type Env } from './env';
import { json, readJson, retryAfterSeconds } from './http';
import { sendToLeadQuik, type LeadQuikResult } from './leadquik';
import type { HitResult } from './limiter';
import { LEAD_DAILY, LEAD_IP, globalLeadName, hitLimiter, leadIpName, type LimitRule } from './limits';
import { verifyTurnstile } from './turnstile';
import { validateLead } from './validation';

// 128 KB, double /chat's cap: a lead carries a transcript of up to 60 entries of 1,000 characters
// (about 60 KB of text, more once multi-byte characters and JSON escapes are counted) plus the form fields.
const BODY_MAX_BYTES = 128 * 1024;

export type Delivery = 'email' | 'email+leadquik' | 'leadquik';

export interface LeadDeps {
  email?: SendOptions;
}

const delivered = (email: boolean, leadquik: LeadQuikResult): Delivery | null => {
  if (email && leadquik === 'ok') return 'email+leadquik';
  if (email) return 'email';
  if (leadquik === 'ok') return 'leadquik';
  return null;
};

const rateLimited = (resetAt: number): Response =>
  json({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': retryAfterSeconds(resetAt) });

/**
 * A lead is worth more than a counter. If the limiter is down, skip that check, say so in
 * the logs, and carry on to Turnstile and delivery: the other guards (validation, Turnstile)
 * still apply, and losing a lead to an infrastructure fault is the worse outcome.
 */
const tolerantHit = async (env: Env, name: string, rule: LimitRule): Promise<HitResult | null> => {
  try {
    return await hitLimiter(env, name, rule);
  } catch {
    console.error(JSON.stringify({ event: 'limiter_error' }));
    return null;
  }
};

/**
 * POST /lead. Order: validate -> per-IP limit (3 per hour) -> Turnstile -> daily lead cap
 * (100 per Eastern-time day, Resend's free tier) -> deliver. Invalid submissions never use up
 * a visitor's allowance, and a failed Turnstile check never uses up the daily cap. Email
 * (Resend) and the LeadQuik hook run side by side and the lead counts as delivered if either
 * works. Nothing about the lead is logged, and nothing is stored: if every path fails the
 * client falls back to the phone number.
 */
export const handleLead = async (request: Request, env: Env, deps: LeadDeps | undefined): Promise<Response> => {
  const body = await readJson(request, BODY_MAX_BYTES);
  if (!body.ok) return json({ ok: false, error: 'validation', fields: {} }, 400);

  const validation = validateLead(body.value);
  if (!validation.ok) return json({ ok: false, error: 'validation', fields: validation.fields }, 400);
  const lead = validation.value;
  const ip = request.headers.get('CF-Connecting-IP');

  const ipHit = await tolerantHit(env, await leadIpName(ip ?? 'unknown', env.RATE_SALT), LEAD_IP);
  if (ipHit && !ipHit.allowed) return rateLimited(ipHit.resetAt);

  if (!(await verifyTurnstile(lead.turnstileToken, ip, turnstileSecret(env)))) {
    return json({ ok: false, error: 'verification_failed' }, 403);
  }

  const dayHit = await tolerantHit(env, globalLeadName(), LEAD_DAILY);
  if (dayHit && !dayHit.allowed) return rateLimited(dayHit.resetAt);

  const now = new Date();
  const [emailSent, leadquik] = await Promise.all([
    sendViaResend(env, buildLeadEmail(lead, now), deps?.email).catch(() => false),
    sendToLeadQuik(lead, leadquikUrl(env), now).catch((): LeadQuikResult => 'failed'),
  ]);

  const delivery = delivered(emailSent, leadquik);
  if (delivery === null) {
    console.error(JSON.stringify({ event: 'lead_delivery_failed', email: emailSent, leadquik }));
    return json({ ok: false, error: 'delivery_failed' }, 502);
  }
  console.log(JSON.stringify({ event: 'lead_delivered', delivery }));
  return json({ ok: true, delivery });
};
