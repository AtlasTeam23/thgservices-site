export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const DEFAULT_TIMEOUT_MS = 5000;
const TOKEN_MAX = 2048;

// Per-isolate "already warned" flag. It carries no request data, so sharing it
// across requests is intended: the warning appears once per isolate, not per request.
let warnedMissingSecret = false;

/** Test hook: lets the once-per-isolate warning be observed again. */
export const resetTurnstileWarning = (): void => {
  warnedMissingSecret = false;
};

/**
 * Server-side Turnstile check. Returns true only when Cloudflare answers
 * `success: true`. Any failure (bad token, HTTP error, timeout, junk response)
 * counts as not verified.
 *
 * With no secret configured verification is skipped and this returns true, so the
 * site works before Turnstile is set up; /health reports `turnstile: false` then.
 */
export const verifyTurnstile = async (
  token: string | undefined,
  ip: string | null,
  secret: string | undefined,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<boolean> => {
  if (!secret) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.warn('TURNSTILE_SECRET_KEY is not set; Turnstile verification is skipped');
    }
    return true;
  }
  if (!token || token.length > TOKEN_MAX) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: unknown; 'error-codes'?: unknown };
    if (result.success === true) return true;
    // Error codes such as "timeout-or-duplicate" are public strings, useful when debugging.
    console.warn(JSON.stringify({ event: 'turnstile_rejected', codes: result['error-codes'] ?? [] }));
    return false;
  } catch {
    return false;
  }
};
