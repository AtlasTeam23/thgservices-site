import { allowedOrigins, type Env } from './env';
import { json } from './http';

export const ALLOW_METHODS = 'POST, OPTIONS';
export const ALLOW_HEADERS = 'Content-Type';
export const MAX_AGE_SECONDS = '86400';

export type OriginCheck =
  | { status: 'none' } // no Origin header: curl, health monitors, server-to-server
  | { status: 'allowed'; origin: string }
  | { status: 'denied' };

/**
 * CORS is a browser-side rule, not authentication: a non-browser client can send
 * any Origin it likes. We therefore only refuse requests that *present* an
 * origin outside the allow-list; rate limits and Turnstile are the real guards.
 * Matching is an exact string comparison, the same way browsers serialize it.
 */
export const checkOrigin = (request: Request, env: Env): OriginCheck => {
  const origin = request.headers.get('Origin');
  if (origin === null) return { status: 'none' };
  return allowedOrigins(env).includes(origin) ? { status: 'allowed', origin } : { status: 'denied' };
};

const addVaryOrigin = (headers: Headers): void => {
  const existing = headers.get('Vary');
  if (!existing) headers.set('Vary', 'Origin');
  else if (!/(^|,)\s*origin\s*(,|$)/i.test(existing)) headers.set('Vary', `${existing}, Origin`);
};

/** 403 for a presented-but-unlisted Origin. Deliberately carries no Access-Control-Allow-Origin. */
export const originDenied = (): Response =>
  json({ error: 'origin_not_allowed' }, 403, { Vary: 'Origin' });

/** Copies `response` and adds `Vary: Origin` plus ACAO when the origin is allowed. */
export const withCors = (response: Response, check: OriginCheck): Response => {
  const headers = new Headers(response.headers);
  addVaryOrigin(headers);
  if (check.status === 'allowed') {
    headers.set('Access-Control-Allow-Origin', check.origin);
    // Without this the browser hides Retry-After from the page's fetch() on a cross-origin 429.
    headers.set('Access-Control-Expose-Headers', 'Retry-After');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const preflight = (check: OriginCheck): Response => {
  const headers = new Headers();
  if (check.status === 'allowed') {
    headers.set('Access-Control-Allow-Origin', check.origin);
    headers.set('Access-Control-Allow-Methods', ALLOW_METHODS);
    headers.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
    headers.set('Access-Control-Max-Age', MAX_AGE_SECONDS);
  }
  addVaryOrigin(headers);
  return new Response(null, { status: 204, headers });
};
