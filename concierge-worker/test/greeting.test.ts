import { describe, expect, it } from 'vitest';
import { VOICE_SETTINGS as WORKER_VOICE_SETTINGS } from '../src/elevenlabs';
import { VOICE_SETTINGS as SCRIPT_VOICE_SETTINGS, requestBody } from '../scripts/eleven-greeting.mjs';
import greetingJson from '../../vite-app/public/concierge/greeting.json?raw';
import wranglerText from '../wrangler.jsonc?raw';

// The widget opens the chat with a recorded greeting (vite-app/public/concierge/greeting.mp3, made once by
// `npm run eleven:greeting`). It has to be the voice the replies use: these tests fail when wrangler.jsonc
// changes the voice, the model or the format without the greeting being recorded again, and when the script's
// voice settings drift from the ones the Worker sends with every spoken reply.

/** Parses JSONC the way config.test.ts does: removes // and /* *\/ comments outside strings, and trailing commas. */
const parseJsonc = (text: string): Record<string, any> => {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
    } else {
      out += ch;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
};

const config = parseJsonc(wranglerText);
const greeting = JSON.parse(greetingJson) as Record<string, unknown>;

describe('the recorded greeting (vite-app/public/concierge/greeting.json)', () => {
  it('was made with the voice, model and format wrangler.jsonc names; record it again if one of them changed', () => {
    expect(greeting.voiceId).toBe(config.vars.VOICE_ELEVEN_VOICE_ID);
    expect(greeting.modelId).toBe(config.vars.VOICE_ELEVEN_MODEL);
    expect(greeting.format).toBe(config.vars.VOICE_ELEVEN_FORMAT);
  });

  it('says what it is: text, voice, model, format and when it was recorded', () => {
    expect(Object.keys(greeting)).toEqual(['text', 'voiceId', 'modelId', 'format', 'generatedAt']);
    expect(typeof greeting.text).toBe('string');
    expect((greeting.text as string).length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(greeting.generatedAt as string))).toBe(false);
  });
});

describe('the greeting script and the Worker speak the same way', () => {
  it('sends the same voice settings the Worker sends with every spoken reply', () => {
    expect(SCRIPT_VOICE_SETTINGS).toEqual(WORKER_VOICE_SETTINGS);
    expect(requestBody('Hello.', 'eleven_flash_v2_5').voice_settings).toEqual(WORKER_VOICE_SETTINGS);
  });

  it('sends the same body fields the Worker does, with text normalization on auto', () => {
    expect(requestBody('Hello.', 'm')).toEqual({
      text: 'Hello.',
      model_id: 'm',
      voice_settings: WORKER_VOICE_SETTINGS,
      apply_text_normalization: 'auto',
    });
  });
});
