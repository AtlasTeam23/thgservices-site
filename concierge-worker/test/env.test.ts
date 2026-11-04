import { describe, expect, it } from 'vitest';
import {
  dailySttSeconds,
  dailyTtsChars,
  dailyLlmCap,
  isEmailConfigured,
  isLlmConfigured,
  isTurnstileConfigured,
  leadquikUrl,
  llmApiKey,
  llmStatus,
  isSttAvailable,
  resendApiKey,
  sessionVoiceSeconds,
  turnstileSecret,
  ttsMode,
  voiceSpeaker,
} from '../src/env';
import { aiStub, testEnv } from './helpers';

describe('dailyLlmCap', () => {
  it.each([
    ['2000', 2000],
    ['1', 1],
    [' 25 ', 25],
    ['12.9', 12],
  ])('reads %j as %i', (value, expected) => {
    expect(dailyLlmCap(testEnv({ DAILY_LLM_CAP: value }))).toBe(expected);
  });

  it('accepts 0, which switches the model off for the day', () => {
    expect(dailyLlmCap(testEnv({ DAILY_LLM_CAP: '0' }))).toBe(0);
  });

  it.each([undefined, '', '   ', 'abc', '-5', 'NaN'])('falls back to 2000 for %j', (value) => {
    expect(dailyLlmCap(testEnv({ DAILY_LLM_CAP: value }))).toBe(2000);
  });
});

describe('secret accessors', () => {
  it('return the value trimmed once, so every caller uses the same clean string', () => {
    const env = testEnv({
      LLM_API_KEY: '  key-one\n',
      RESEND_API_KEY: '\tkey-two  ',
      TURNSTILE_SECRET_KEY: ' secret-three ',
      LEADQUIK_WEBHOOK_URL: '\nhttps://hooks.example/x \n',
    });
    expect(llmApiKey(env)).toBe('key-one');
    expect(resendApiKey(env)).toBe('key-two');
    expect(turnstileSecret(env)).toBe('secret-three');
    expect(leadquikUrl(env)).toBe('https://hooks.example/x');
  });

  it('return undefined for missing, empty or whitespace-only values', () => {
    for (const value of [undefined, '', '   ', '\n\t']) {
      const env = testEnv({ LLM_API_KEY: value, RESEND_API_KEY: value, TURNSTILE_SECRET_KEY: value, LEADQUIK_WEBHOOK_URL: value });
      expect(llmApiKey(env)).toBeUndefined();
      expect(resendApiKey(env)).toBeUndefined();
      expect(turnstileSecret(env)).toBeUndefined();
      expect(leadquikUrl(env)).toBeUndefined();
    }
  });

  it('drive the configured flags', () => {
    const blank = testEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: ' ', RESEND_API_KEY: ' ', TURNSTILE_SECRET_KEY: ' ' });
    expect(isLlmConfigured(blank)).toBe(false);
    expect(llmStatus(blank)).toBe('unconfigured');
    expect(isEmailConfigured(blank)).toBe(false);
    expect(isTurnstileConfigured(blank)).toBe(false);

    const set = testEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: ' k ', RESEND_API_KEY: ' r ', TURNSTILE_SECRET_KEY: ' t ' });
    expect(isLlmConfigured(set)).toBe(true);
    expect(llmStatus(set)).toBe('anthropic');
    expect(isEmailConfigured(set)).toBe(true);
    expect(isTurnstileConfigured(set)).toBe(true);
  });
});

describe('voice budgets', () => {
  const cases = [
    ['dailySttSeconds', dailySttSeconds, 'VOICE_DAILY_STT_SECONDS', 9000],
    ['sessionVoiceSeconds', sessionVoiceSeconds, 'VOICE_SESSION_SECONDS', 180],
    ['dailyTtsChars', dailyTtsChars, 'VOICE_DAILY_TTS_CHARS', 100000],
  ] as const;

  describe.each(cases)('%s', (_name, read, key, fallback) => {
    it.each([
      ['500', 500],
      [' 25 ', 25],
      ['12.9', 12],
    ])('reads %j as %i', (value, expected) => {
      expect(read(testEnv({ [key]: value }))).toBe(expected);
    });

    it('accepts 0, which switches that budget off', () => {
      expect(read(testEnv({ [key]: '0' }))).toBe(0);
    });

    it.each([undefined, '', '   ', 'abc', '-5', 'NaN'])(`falls back to ${fallback} for %j`, (value) => {
      expect(read(testEnv({ [key]: value }))).toBe(fallback);
    });
  });
});

describe('ttsMode', () => {
  it('is "aura" only for the value aura, ignoring case and spaces', () => {
    for (const value of ['aura', 'AURA', ' Aura\n']) expect(ttsMode(testEnv({ VOICE_TTS: value }))).toBe('aura');
  });

  it.each([undefined, '', 'browser', 'elevenlabs', 'aura2'])('is "browser" for %j', (value) => {
    expect(ttsMode(testEnv({ VOICE_TTS: value }))).toBe('browser');
  });
});

describe('voiceSpeaker', () => {
  it('returns a known Aura speaker, normalized', () => {
    expect(voiceSpeaker(testEnv({ VOICE_SPEAKER: 'luna' }))).toBe('luna');
    expect(voiceSpeaker(testEnv({ VOICE_SPEAKER: ' Orion ' }))).toBe('orion');
  });

  it.each([undefined, '', 'nobody', 'asteria; drop'])('falls back to asteria for %j', (value) => {
    expect(voiceSpeaker(testEnv({ VOICE_SPEAKER: value }))).toBe('asteria');
  });
});

describe('isSttAvailable', () => {
  it('needs the AI binding and a positive daily and session budget', () => {
    const { ai } = aiStub();
    expect(isSttAvailable(testEnv({ AI: ai }))).toBe(true);
    expect(isSttAvailable(testEnv({ AI: undefined }))).toBe(false);
    expect(isSttAvailable(testEnv({ AI: ai, VOICE_DAILY_STT_SECONDS: '0' }))).toBe(false);
    expect(isSttAvailable(testEnv({ AI: ai, VOICE_SESSION_SECONDS: '0' }))).toBe(false);
  });
});
