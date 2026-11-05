import { checkerRequiresTurnstile, isCheckerGraderConfigured, turnstileSecret, type Env } from '../env';
import { json } from '../http';
import { verifyTurnstile } from '../turnstile';

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * True when the Worker itself is being reached on this machine (`wrangler dev`): decided from the host in the
 * request URL, never from the Origin header, which any caller can set to http://localhost:3000.
 */
export const isLocalOrigin = (request: Request): boolean => {
  try {
    return LOCAL_HOSTS.has(new URL(request.url).hostname);
  } catch {
    return false;
  }
};

export const notReady = (): Response => json({ ok: false, error: 'checker_not_ready' }, 503);

/**
 * The launch gate. The checker is not ready when it cannot reach its grader, or when Turnstile is
 * required (CHECKER_REQUIRE_TURNSTILE, on unless it is exactly "false") but no Turnstile secret
 * exists and the page is not a local one. Without this a missing secret would silently let every
 * request through, because verifyTurnstile passes when it has no secret.
 */
export const isNotReady = (request: Request, env: Env): boolean => {
  if (!isCheckerGraderConfigured(env)) return true;
  return checkerRequiresTurnstile(env) && turnstileSecret(env) === undefined && !isLocalOrigin(request);
};

/**
 * True when the request passes the Turnstile check. When the gate is on, a missing or bad token fails.
 * When it is off, a token is verified only if one was sent (and a secret exists): honeypot and limits
 * are then the only guards.
 */
export const passesTurnstile = async (
  request: Request,
  env: Env,
  token: string | undefined,
): Promise<boolean> => {
  const secret = turnstileSecret(env);
  const ip = request.headers.get('CF-Connecting-IP');
  if (checkerRequiresTurnstile(env)) return verifyTurnstile(token, ip, secret);
  if (secret === undefined || token === undefined) return true;
  return verifyTurnstile(token, ip, secret);
};
