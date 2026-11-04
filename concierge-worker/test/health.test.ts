import { describe, expect, it } from 'vitest';
import { call, testEnv } from './helpers';

describe('GET /health', () => {
  it('reports the mock provider and no secrets under the test vars', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(await res.json()).toEqual({ ok: true, llm: 'mock', email: false, turnstile: false });
  });

  it('reflects which secrets are set without echoing their values', async () => {
    const env = testEnv({
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: 'placeholder-not-a-real-key',
      RESEND_API_KEY: 'placeholder-not-a-real-key',
      TURNSTILE_SECRET_KEY: 'placeholder-not-a-real-secret',
    });
    const res = await call('/health', { env });
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, llm: 'anthropic', email: true, turnstile: true });
    expect(text).not.toContain('placeholder');
  });

  it('reports "unconfigured" when the provider is anthropic but no key is set', async () => {
    const res = await call('/health', { env: testEnv({ LLM_PROVIDER: 'anthropic' }) });
    expect(await res.json()).toMatchObject({ llm: 'unconfigured' });
  });
});
