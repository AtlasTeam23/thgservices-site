import { describe, expect, it } from 'vitest';
import {
  dailyLlmCap,
  isEmailConfigured,
  isLlmConfigured,
  isTurnstileConfigured,
  leadquikUrl,
  llmApiKey,
  llmStatus,
  resendApiKey,
  turnstileSecret,
} from '../src/env';
import { testEnv } from './helpers';

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
