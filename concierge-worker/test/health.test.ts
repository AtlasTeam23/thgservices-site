import { describe, expect, it } from 'vitest';
import { aiStub, call, testEnv } from './helpers';

describe('GET /health', () => {
  it('reports the mock provider and no secrets under the test vars', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(await res.json()).toEqual({
      ok: true,
      llm: 'mock',
      email: false,
      turnstile: false,
      voice: { stt: false, tts: 'browser' },
    });
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
    expect(JSON.parse(text)).toEqual({
      ok: true,
      llm: 'anthropic',
      email: true,
      turnstile: true,
      voice: { stt: false, tts: 'browser' },
    });
    expect(text).not.toContain('placeholder');
  });

  it('reports "unconfigured" when the provider is anthropic but no key is set', async () => {
    const res = await call('/health', { env: testEnv({ LLM_PROVIDER: 'anthropic' }) });
    expect(await res.json()).toMatchObject({ llm: 'unconfigured' });
  });
});

describe('GET /health voice block', () => {
  const voice = async (overrides: Record<string, unknown>) => {
    const res = await call('/health', { env: testEnv(overrides) });
    return ((await res.json()) as { voice: unknown }).voice;
  };

  it('says speech-to-text is on once the AI binding is present', async () => {
    expect(await voice({ AI: aiStub().ai })).toEqual({ stt: true, tts: 'browser' });
  });

  it('says it is off with no AI binding', async () => {
    expect(await voice({ AI: undefined })).toEqual({ stt: false, tts: 'browser' });
  });

  it.each(['0', '-3', 'abc'])('turns stt off when the daily budget is %j', async (value) => {
    // 0 is an explicit off switch; junk falls back to the default, which is on.
    const stt = value === '0';
    expect(await voice({ AI: aiStub().ai, VOICE_DAILY_STT_SECONDS: value })).toEqual({ stt: !stt, tts: 'browser' });
  });

  it('turns stt off when the per-session budget is 0', async () => {
    expect(await voice({ AI: aiStub().ai, VOICE_SESSION_SECONDS: '0' })).toEqual({ stt: false, tts: 'browser' });
  });

  it('reports the premium voice only when it is selected AND the binding exists', async () => {
    expect(await voice({ AI: aiStub().ai, VOICE_TTS: 'aura' })).toEqual({ stt: true, tts: 'aura' });
    expect(await voice({ AI: aiStub().ai, VOICE_TTS: ' AURA ' })).toEqual({ stt: true, tts: 'aura' });
    expect(await voice({ AI: undefined, VOICE_TTS: 'aura' })).toEqual({ stt: false, tts: 'browser' });
  });

  it('treats any other VOICE_TTS value as the browser voice', async () => {
    expect(await voice({ AI: aiStub().ai, VOICE_TTS: 'elevenlabs' })).toEqual({ stt: true, tts: 'browser' });
    expect(await voice({ AI: aiStub().ai, VOICE_TTS: undefined })).toEqual({ stt: true, tts: 'browser' });
  });
});
