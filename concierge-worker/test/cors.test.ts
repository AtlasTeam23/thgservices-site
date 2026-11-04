import { describe, expect, it } from 'vitest';
import { call } from './helpers';

const ALLOWED = [
  'https://thgservices.io',
  'https://www.thgservices.io',
  'http://localhost:3000',
  'http://localhost:4173',
];

describe('CORS', () => {
  it.each(ALLOWED)('echoes allowed origin %s with Vary: Origin', async (origin) => {
    const res = await call('/health', { origin });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(res.headers.get('Vary')).toMatch(/Origin/i);
  });

  it('lets the page read Retry-After on every response from an allowed origin', async () => {
    for (const path of ['/health', '/nope']) {
      const res = await call(path, { origin: 'https://thgservices.io' });
      expect(res.headers.get('Access-Control-Expose-Headers'), path).toBe('Retry-After');
    }
  });

  it('does not send CORS headers of any kind to a disallowed origin or when there is no Origin', async () => {
    const denied = await call('/health', { origin: 'https://evil.example' });
    expect(denied.headers.get('Access-Control-Expose-Headers')).toBeNull();
    const none = await call('/health', { origin: null });
    expect(none.headers.get('Access-Control-Expose-Headers')).toBeNull();
  });

  it('rejects a disallowed origin with 403 and no Access-Control-Allow-Origin', async () => {
    const res = await call('/health', { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(await res.json()).toEqual({ error: 'origin_not_allowed' });
  });

  it.each([
    'null',
    'http://thgservices.io',
    'https://thgservices.io.evil.example',
    'https://thgservices.io/',
    'https://evil.example/https://thgservices.io',
    'HTTPS://THGSERVICES.IO',
    'http://localhost:8080',
  ])('treats %s as a different origin', async (origin) => {
    const res = await call('/health', { origin });
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('blocks POST /chat from a disallowed origin before doing anything else', async () => {
    const res = await call('/chat', { origin: 'https://evil.example', body: { anything: true } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'origin_not_allowed' });
  });

  it('answers an allowed preflight with 204 and the documented headers', async () => {
    const res = await call('/chat', {
      method: 'OPTIONS',
      origin: 'https://thgservices.io',
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://thgservices.io');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    expect(res.headers.get('Vary')).toMatch(/Origin/i);
    expect(await res.text()).toBe('');
  });

  it('rejects a preflight from a disallowed origin', async () => {
    const res = await call('/lead', { method: 'OPTIONS', origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Access-Control-Allow-Methods')).toBeNull();
  });

  it('allows requests with no Origin header (curl, monitors) without CORS headers', async () => {
    const res = await call('/health', { origin: null });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('adds CORS headers to error responses too (404)', async () => {
    const res = await call('/nope', { origin: 'http://localhost:3000' });
    expect(res.status).toBe(404);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
  });

  it('honours a custom ALLOWED_ORIGINS list from the environment', async () => {
    const { testEnv } = await import('./helpers');
    const env = testEnv({ ALLOWED_ORIGINS: ' https://a.example , https://b.example ' });
    expect((await call('/health', { env, origin: 'https://b.example' })).status).toBe(200);
    expect((await call('/health', { env, origin: 'https://thgservices.io' })).status).toBe(403);
  });
});
