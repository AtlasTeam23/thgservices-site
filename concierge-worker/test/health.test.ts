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

  it('says speech-to-text is on once the AI binding is present, and off without it', async () => {
    expect(await voice({ AI: aiStub().ai })).toEqual({ stt: true, tts: 'browser' });
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

  describe('the paid reply voice reports tts: "server" with its provider', () => {
    it('Aura: configured when the binding exists, and the model it will really use', async () => {
      const ai = aiStub().ai;
      expect(await voice({ AI: ai, VOICE_TTS: 'aura' })).toEqual({ stt: true, tts: 'server', provider: 'aura', configured: true, ttsModel: 'aura-1' });
      expect(await voice({ AI: ai, VOICE_TTS: ' AURA ' })).toMatchObject({ provider: 'aura', configured: true });
      expect(await voice({ AI: ai, VOICE_TTS: 'aura', VOICE_TTS_MODEL: 'aura-2' })).toMatchObject({ ttsModel: 'aura-2' });
      expect(await voice({ AI: ai, VOICE_TTS: 'aura', VOICE_TTS_MODEL: ' Aura-2 ' })).toMatchObject({ ttsModel: 'aura-2' });
      expect(await voice({ AI: ai, VOICE_TTS: 'aura', VOICE_TTS_MODEL: 'aura-3' })).toMatchObject({ ttsModel: 'aura-1' }); // what the Worker will really use
      expect(await voice({ AI: undefined, VOICE_TTS: 'aura' })).toEqual({ stt: false, tts: 'server', provider: 'aura', configured: false, ttsModel: 'aura-1' });
    });

    it('ElevenLabs: configured only with both the key and a voice id, with the model it will use', async () => {
      const full = { VOICE_TTS: 'elevenlabs', ELEVENLABS_API_KEY: 'k-placeholder', VOICE_ELEVEN_VOICE_ID: '21m00Tcm4TlvDq8ikWAM' };
      expect(await voice({ AI: aiStub().ai, ...full })).toEqual({
        stt: true,
        tts: 'server',
        provider: 'elevenlabs',
        configured: true,
        ttsModel: 'eleven_flash_v2_5',
      });
      expect(await voice({ AI: undefined, ...full })).toMatchObject({ stt: false, configured: true }); // speech-to-text and the reply voice are independent
      expect(await voice({ ...full, VOICE_ELEVEN_VOICE_ID: '' })).toMatchObject({ tts: 'server', provider: 'elevenlabs', configured: false });
      expect(await voice({ ...full, ELEVENLABS_API_KEY: undefined })).toMatchObject({ provider: 'elevenlabs', configured: false });
      expect(await voice({ ...full, VOICE_ELEVEN_MODEL: 'eleven_turbo_v2_5' })).toMatchObject({ ttsModel: 'eleven_turbo_v2_5' });
    });

    it('never echoes the key or the voice id', async () => {
      const env = testEnv({ VOICE_TTS: 'elevenlabs', ELEVENLABS_API_KEY: 'k-placeholder-123', VOICE_ELEVEN_VOICE_ID: '21m00Tcm4TlvDq8ikWAM' });
      const text = await (await call('/health', { env })).text();
      expect(text).not.toMatch(/k-placeholder-123|21m00Tcm4TlvDq8ikWAM/);
    });
  });

  it('keeps the browser voice for any other VOICE_TTS value, and leaves the provider fields out', async () => {
    for (const value of ['browser', 'elevenlabs2', 'eleven', 'server', '', undefined]) {
      expect(await voice({ AI: aiStub().ai, VOICE_TTS: value, VOICE_TTS_MODEL: 'aura-2' }), String(value)).toEqual({ stt: true, tts: 'browser' });
    }
  });
});
