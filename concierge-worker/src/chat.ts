import { ENDED, LEAD_ONLY, OFF_TOPIC_REPLY, RATE_LIMITED, TOO_LONG } from './copy';
import { dailyLlmCap, isLlmConfigured, turnstileSecret, type Env } from './env';
import { screenTurns } from './guards';
import { json, readJson, retryAfterSeconds } from './http';
import {
  CHAT_IP,
  CHAT_SESSION,
  DAY_SECONDS,
  TURNSTILE_AFTER_MESSAGES,
  chatIpName,
  globalName,
  hitLimiter,
  llmDailyRule,
  sessionName,
} from './limits';
import { LlmUnavailableError, generateReply, type GenerateDeps } from './llm';
import { verifyTurnstile } from './turnstile';
import { selectRecentTurns, validateChat, type ChatPayload } from './validation';

const BODY_MAX_BYTES = 64 * 1024;

const rateLimited = (resetAt: number): Response =>
  json({ error: 'rate_limited', reply: RATE_LIMITED }, 429, { 'Retry-After': retryAfterSeconds(resetAt) });

const ended = (): Response => json({ error: 'ended', reply: ENDED }, 403);

const capacity = (): Response => json({ error: 'capacity', mode: 'lead_only', reply: LEAD_ONLY }, 503);

/** A Durable Object call failed. /chat cannot enforce its limits, so it stops taking messages. */
class LimiterError extends Error {
  override readonly name = 'LimiterError';
}

const viaLimiter = async <T>(work: Promise<T>): Promise<T> => {
  try {
    return await work;
  } catch {
    throw new LimiterError('limiter unavailable');
  }
};

/**
 * POST /chat. Check order (contract section 2.3): validate -> session limit -> IP limit ->
 * guards -> Turnstile -> model configured -> global daily cap -> model. The global
 * counter only moves when a model call is actually about to happen.
 *
 * If the limiter itself is down the answer is the 503 lead-only response: without it there
 * is no abuse protection or spending cap, so no model call is made, but the widget keeps
 * working as a lead form.
 */
export const handleChat = async (request: Request, env: Env, llm: GenerateDeps | undefined): Promise<Response> => {
  const body = await readJson(request, BODY_MAX_BYTES);
  if (!body.ok) return json({ error: 'bad_request' }, 400);

  const validation = validateChat(body.value);
  if (!validation.ok) {
    return validation.error === 'message_too_long'
      ? json({ error: 'message_too_long', reply: TOO_LONG }, 400)
      : json({ error: 'bad_request' }, 400);
  }

  try {
    return await respond(request, env, llm, validation.value);
  } catch (error) {
    if (error instanceof LimiterError) {
      console.error(JSON.stringify({ event: 'limiter_error' }));
      return capacity();
    }
    throw error;
  }
};

const respond = async (
  request: Request,
  env: Env,
  llm: GenerateDeps | undefined,
  { sessionId, messages, turnstileToken }: ChatPayload,
): Promise<Response> => {
  const ip = request.headers.get('CF-Connecting-IP');

  const session = await viaLimiter(hitLimiter(env, sessionName(sessionId), CHAT_SESSION));
  if (session.ended) return ended();
  if (!session.allowed) return rateLimited(session.resetAt);

  const ipName = await chatIpName(ip ?? 'unknown', env.RATE_SALT);
  const ipHit = await viaLimiter(hitLimiter(env, ipName, CHAT_IP));
  if (!ipHit.allowed) return rateLimited(ipHit.resetAt);

  // The client sends the whole thread and the server cannot tell an honest history from a
  // forged one, so every visitor turn that will be forwarded is screened, not just the latest:
  // abuse anywhere ends the chat, an injection in the latest message gets the decline, and an
  // injection in an earlier turn is removed (with its reply) so it never reaches the model.
  const screened = screenTurns(selectRecentTurns(messages));
  if (screened.kind === 'abuse') {
    await viaLimiter(env.LIMITER.getByName(sessionName(sessionId)).end(DAY_SECONDS)); // the session stays ended
    return ended();
  }
  if (screened.kind === 'injection') {
    return json({ reply: OFF_TOPIC_REPLY, intent: 'off_topic', offerCallback: false });
  }
  const turns = screened.turns;

  // Either count trips the check, so a client cannot dodge Turnstile by minting new session ids.
  if (Math.max(session.count, ipHit.count) > TURNSTILE_AFTER_MESSAGES) {
    const verified = await verifyTurnstile(turnstileToken, ip, turnstileSecret(env));
    if (!verified) return json({ error: 'verification_required' }, 403);
  }

  if (!isLlmConfigured(env)) return capacity();

  const cap = dailyLlmCap(env);
  if (cap === 0) return capacity(); // 0 switches the model off; no need to touch the counter
  const day = await viaLimiter(hitLimiter(env, globalName(), llmDailyRule(cap)));
  if (!day.allowed) return capacity();

  try {
    return json(await generateReply(env, turns, llm));
  } catch (error) {
    if (error instanceof LlmUnavailableError) return capacity();
    throw error;
  }
};
