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
  AURA_1_SPEAKERS,
  AURA_2_SPEAKERS,
  ELEVEN_MP3_FORMATS,
  elevenConfig,
  ttsBonus,
  ttsModelName,
  ttsPerIpPerDay,
  ttsProvider,
  ttsVoice,
  voiceHealth,
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
    ['dailyTtsChars', dailyTtsChars, 'VOICE_DAILY_TTS_CHARS', 50000],
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

describe('ttsProvider', () => {
  it('is "aura" or "elevenlabs" only for exactly those values, ignoring case and spaces', () => {
    for (const value of ['aura', 'AURA', ' Aura\n']) expect(ttsProvider(testEnv({ VOICE_TTS: value }))).toBe('aura');
    for (const value of ['elevenlabs', 'ElevenLabs', ' ELEVENLABS \n']) expect(ttsProvider(testEnv({ VOICE_TTS: value }))).toBe('elevenlabs');
  });

  it.each([undefined, '', 'browser', 'eleven', 'eleven-labs', 'elevenlabs2', 'aura2', 'aura-2', 'server'])('is "browser" for %j', (value) => {
    expect(ttsProvider(testEnv({ VOICE_TTS: value }))).toBe('browser');
  });
});

describe('ElevenLabs settings', () => {
  const KEY = 'placeholder-not-a-real-key';
  const VOICE = '21m00Tcm4TlvDq8ikWAM';
  const configured = (extra: Record<string, unknown> = {}) =>
    testEnv({ VOICE_TTS: 'elevenlabs', ELEVENLABS_API_KEY: KEY, VOICE_ELEVEN_VOICE_ID: VOICE, ...extra });

  it('are complete with a key and a voice id, and default to Flash and a 32 kbps 22 kHz MP3', () => {
    expect(elevenConfig(configured())).toEqual({
      apiKey: KEY,
      voiceId: VOICE,
      model: 'eleven_flash_v2_5',
      format: 'mp3_22050_32',
    });
  });

  it('are incomplete without a key, or with a blank or missing voice id', () => {
    expect(elevenConfig(configured({ ELEVENLABS_API_KEY: undefined }))).toBeNull();
    expect(elevenConfig(configured({ ELEVENLABS_API_KEY: '   ' }))).toBeNull();
    for (const voice of [undefined, '', '   ']) expect(elevenConfig(configured({ VOICE_ELEVEN_VOICE_ID: voice }))).toBeNull();
  });

  it('trim the key and the voice id', () => {
    expect(elevenConfig(configured({ ELEVENLABS_API_KEY: ` ${KEY}\n`, VOICE_ELEVEN_VOICE_ID: `  ${VOICE} ` }))).toMatchObject({ apiKey: KEY, voiceId: VOICE });
  });

  it.each(['a/b', '../voices', 'abc def12345', 'short', 'x'.repeat(65), 'abc?output=1', '21m00Tcm4TlvDq8ikWAM%2F..', 'voice;id12345'])(
    'treat the voice id %j as not configured: it goes into a URL path',
    (voice) => {
      expect(elevenConfig(configured({ VOICE_ELEVEN_VOICE_ID: voice }))).toBeNull();
    },
  );

  it('take any sensible model name, and fall back to Flash for a blank or odd one', () => {
    expect(elevenConfig(configured({ VOICE_ELEVEN_MODEL: 'eleven_turbo_v2_5' }))?.model).toBe('eleven_turbo_v2_5');
    expect(elevenConfig(configured({ VOICE_ELEVEN_MODEL: ' eleven_multilingual_v2 ' }))?.model).toBe('eleven_multilingual_v2');
    for (const model of [undefined, '', '   ', 'has space', 'with"quote', 'x'.repeat(65)]) {
      expect(elevenConfig(configured({ VOICE_ELEVEN_MODEL: model }))?.model, String(model)).toBe('eleven_flash_v2_5');
    }
  });

  it('allow exactly the seven MP3 output formats, because the Worker labels the audio audio/mpeg', () => {
    expect([...ELEVEN_MP3_FORMATS]).toEqual([
      'mp3_22050_32',
      'mp3_24000_48',
      'mp3_44100_32',
      'mp3_44100_64',
      'mp3_44100_96',
      'mp3_44100_128',
      'mp3_44100_192',
    ]);
    for (const format of ELEVEN_MP3_FORMATS) expect(elevenConfig(configured({ VOICE_ELEVEN_FORMAT: format }))?.format).toBe(format);
    expect(elevenConfig(configured({ VOICE_ELEVEN_FORMAT: ' MP3_44100_128 ' }))?.format).toBe('mp3_44100_128');
  });

  it.each(['pcm_16000', 'opus_48000_32', 'ulaw_8000', 'mp3_44100_999', 'mp3', '', '   ', 'mp3_22050_32&x=1', undefined])(
    'fall back to mp3_22050_32 for the output format %j',
    (format) => {
      expect(elevenConfig(configured({ VOICE_ELEVEN_FORMAT: format }))?.format).toBe('mp3_22050_32');
    },
  );
});

describe('the per-visitor spoken-reply cap', () => {
  it('is 5 replies a day plus a bonus of 5, by default', () => {
    expect(ttsPerIpPerDay(testEnv({ VOICE_TTS_PER_IP_PER_DAY: undefined }))).toBe(5);
    expect(ttsBonus(testEnv({ VOICE_TTS_BONUS: undefined }))).toBe(5);
  });

  it.each([
    ['12', 12],
    [' 7 ', 7],
    ['0', 0],
  ])('reads %j as %i for both vars (0 is valid)', (value, expected) => {
    expect(ttsPerIpPerDay(testEnv({ VOICE_TTS_PER_IP_PER_DAY: value }))).toBe(expected);
    expect(ttsBonus(testEnv({ VOICE_TTS_BONUS: value }))).toBe(expected);
  });

  it.each(['', '   ', 'abc', '-5', 'NaN'])('falls back to 5 for %j', (value) => {
    expect(ttsPerIpPerDay(testEnv({ VOICE_TTS_PER_IP_PER_DAY: value }))).toBe(5);
    expect(ttsBonus(testEnv({ VOICE_TTS_BONUS: value }))).toBe(5);
  });
});

describe('voiceHealth', () => {
  const { ai } = aiStub();
  const eleven = (extra: Record<string, unknown> = {}) =>
    testEnv({ AI: ai, VOICE_TTS: 'elevenlabs', ELEVENLABS_API_KEY: 'k-placeholder', VOICE_ELEVEN_VOICE_ID: '21m00Tcm4TlvDq8ikWAM', ...extra });

  it('says "browser" and nothing else about the paid voice while the browser reads replies', () => {
    expect(voiceHealth(testEnv({ AI: ai }))).toEqual({ stt: true, tts: 'browser' });
    expect(voiceHealth(testEnv({ AI: undefined, VOICE_TTS: 'browser', VOICE_TTS_MODEL: 'aura-2' }))).toEqual({ stt: false, tts: 'browser' });
  });

  it('names Aura and whether it can run (the binding is there), with the model it will use', () => {
    expect(voiceHealth(testEnv({ AI: ai, VOICE_TTS: 'aura' }))).toEqual({ stt: true, tts: 'server', provider: 'aura', configured: true, ttsModel: 'aura-1' });
    expect(voiceHealth(testEnv({ AI: ai, VOICE_TTS: 'aura', VOICE_TTS_MODEL: 'aura-2' }))).toMatchObject({ ttsModel: 'aura-2' });
    expect(voiceHealth(testEnv({ AI: undefined, VOICE_TTS: 'aura' }))).toEqual({ stt: false, tts: 'server', provider: 'aura', configured: false, ttsModel: 'aura-1' });
  });

  it('names ElevenLabs, configured only with both a key and a voice id, with its model', () => {
    expect(voiceHealth(eleven())).toEqual({ stt: true, tts: 'server', provider: 'elevenlabs', configured: true, ttsModel: 'eleven_flash_v2_5' });
    expect(voiceHealth(eleven({ VOICE_ELEVEN_MODEL: 'eleven_turbo_v2_5' }))).toMatchObject({ ttsModel: 'eleven_turbo_v2_5' });
    expect(voiceHealth(eleven({ VOICE_ELEVEN_VOICE_ID: '' }))).toMatchObject({ provider: 'elevenlabs', configured: false });
    expect(voiceHealth(eleven({ ELEVENLABS_API_KEY: undefined }))).toMatchObject({ provider: 'elevenlabs', configured: false });
  });

  it('never carries the key or the voice id', () => {
    expect(JSON.stringify(voiceHealth(eleven()))).not.toMatch(/k-placeholder|21m00Tcm4TlvDq8ikWAM/);
  });
});

describe('ttsModelName', () => {
  it.each([
    ['aura-1', 'aura-1'],
    ['aura-2', 'aura-2'],
    [' AURA-2 ', 'aura-2'],
    ['Aura-1\n', 'aura-1'],
  ])('reads %j as %s', (value, expected) => {
    expect(ttsModelName(testEnv({ VOICE_TTS_MODEL: value }))).toBe(expected);
  });

  it.each([undefined, '', '   ', 'aura', 'aura2', 'aura-2-en', 'aura-3', '@cf/deepgram/aura-2-en', 'elevenlabs'])(
    'falls back to the default, aura-1, for %j',
    (value) => {
      expect(ttsModelName(testEnv({ VOICE_TTS_MODEL: value }))).toBe('aura-1');
    },
  );
});

describe('the Aura speaker allowlists', () => {
  // Confirmed 2026-11-03 three ways: Cloudflare's model pages, the installed @cloudflare/workers-types, and the
  // enum the Workers AI runtime itself prints when it rejects a speaker. Workers AI takes BARE names ("thalia");
  // the "aura-2-thalia-en" form Deepgram uses elsewhere is rejected with a 400.
  const AURA_1 = 'angus asteria arcas orion orpheus athena luna zeus perseus helios hera stella'.split(' ');
  const AURA_2 = (
    'amalthea andromeda apollo arcas aries asteria athena atlas aurora callista cora cordelia delia draco electra ' +
    'harmonia helena hera hermes hyperion iris janus juno jupiter luna mars minerva neptune odysseus ophelia orion ' +
    'orpheus pandora phoebe pluto saturn thalia theia vesta zeus'
  ).split(' ');

  it('are exactly the 12 Aura-1 and 40 Aura-2 speakers the runtime accepts', () => {
    expect([...AURA_1_SPEAKERS].sort()).toEqual([...AURA_1].sort());
    expect([...AURA_2_SPEAKERS].sort()).toEqual([...AURA_2].sort());
    expect(AURA_1_SPEAKERS).toHaveLength(12);
    expect(AURA_2_SPEAKERS).toHaveLength(40);
  });

  it('are bare names, never the "aura-2-thalia-en" form', () => {
    for (const name of [...AURA_1_SPEAKERS, ...AURA_2_SPEAKERS]) expect(name).toMatch(/^[a-z]+$/);
  });
});

describe('ttsVoice', () => {
  const AURA_1_ID = '@cf/deepgram/aura-1';
  const AURA_2_ID = '@cf/deepgram/aura-2-en';

  it.each([
    // [model var, speaker var, model id, speaker used, fell back]
    ['aura-1', undefined, AURA_1_ID, 'asteria', false],
    ['aura-1', '', AURA_1_ID, 'asteria', false],
    ['aura-1', '   ', AURA_1_ID, 'asteria', false],
    ['aura-1', 'angus', AURA_1_ID, 'angus', false],
    ['aura-1', ' Orion ', AURA_1_ID, 'orion', false],
    ['aura-1', 'thalia', AURA_1_ID, 'asteria', true], // an Aura-2 name
    ['aura-1', 'andromeda', AURA_1_ID, 'asteria', true],
    ['aura-1', 'aura-2-thalia-en', AURA_1_ID, 'asteria', true],
    ['aura-1', 'asteria; drop', AURA_1_ID, 'asteria', true],
    [undefined, 'perseus', AURA_1_ID, 'perseus', false], // no model var: Aura-1
    ['aura-2', undefined, AURA_2_ID, 'luna', false],
    ['aura-2', '', AURA_2_ID, 'luna', false],
    ['aura-2', 'thalia', AURA_2_ID, 'thalia', false],
    ['aura-2', 'andromeda', AURA_2_ID, 'andromeda', false],
    ['aura-2', 'helena', AURA_2_ID, 'helena', false],
    ['aura-2', 'apollo', AURA_2_ID, 'apollo', false],
    ['aura-2', 'arcas', AURA_2_ID, 'arcas', false],
    ['aura-2', 'orion', AURA_2_ID, 'orion', false],
    ['aura-2', ' THALIA ', AURA_2_ID, 'thalia', false],
    ['aura-2', 'asteria', AURA_2_ID, 'asteria', false], // the shipped VOICE_SPEAKER is valid on both models
    ['aura-2', 'angus', AURA_2_ID, 'luna', true], // Aura-1 only
    ['aura-2', 'perseus', AURA_2_ID, 'luna', true],
    ['aura-2', 'helios', AURA_2_ID, 'luna', true],
    ['aura-2', 'stella', AURA_2_ID, 'luna', true],
    ['aura-2', 'aura-2-thalia-en', AURA_2_ID, 'luna', true], // Deepgram's own form, which Workers AI rejects
    ['aura-2', 'nobody', AURA_2_ID, 'luna', true],
    ['aura-3', 'thalia', AURA_1_ID, 'asteria', true], // an unknown model is Aura-1, so an Aura-2 name no longer fits
  ])('with model %j and speaker %j uses %s with %s (fallback: %s)', (model, speaker, modelId, used, fellBack) => {
    const voice = ttsVoice(testEnv({ VOICE_TTS_MODEL: model, VOICE_SPEAKER: speaker }));
    expect(voice).toMatchObject({ modelId, speaker: used, fellBack });
  });

  it('names the model and keeps the rejected value for the log', () => {
    const voice = ttsVoice(testEnv({ VOICE_TTS_MODEL: 'aura-2', VOICE_SPEAKER: ' Angus ' }));
    expect(voice).toMatchObject({ model: 'aura-2', requested: 'angus', speaker: 'luna', fellBack: true });
  });

  it('never reports a fallback when no speaker was asked for', () => {
    for (const model of ['aura-1', 'aura-2']) {
      for (const speaker of [undefined, '', '  ']) {
        expect(ttsVoice(testEnv({ VOICE_TTS_MODEL: model, VOICE_SPEAKER: speaker })).fellBack).toBe(false);
      }
    }
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
