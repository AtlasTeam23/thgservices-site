/// <reference types="node" />
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GREETING } from '../copy';
import { GREETING_URL } from '../voice/greeting';

// The opening greeting is a recording (public/concierge/greeting.mp3, made once by `npm run eleven:greeting` in
// concierge-worker). It says whatever it was recorded saying, so these tests fail the moment GREETING changes
// without a new recording: the visitor would otherwise read one thing and hear another.

const PUBLIC = join(import.meta.dirname, '..', '..', '..', '..', 'public');
const MP3 = join(PUBLIC, 'concierge', 'greeting.mp3');
const SIDECAR = join(PUBLIC, 'concierge', 'greeting.json');

/** The command that makes the recording again, with the text safely quoted for a shell. */
const regenerate = (text: string) =>
  `cd concierge-worker && npm run eleven:greeting -- --text '${text.replace(/'/g, `'\\''`)}'`;

const sidecar = JSON.parse(readFileSync(SIDECAR, 'utf8')) as Record<string, unknown>;

describe('the recorded greeting', () => {
  it('says exactly what GREETING says; if this fails the copy changed, so record it again', () => {
    expect(
      sidecar.text,
      `greeting.mp3 was recorded saying something else than GREETING in copy.ts. Record it again:\n${regenerate(GREETING)}\n`
    ).toBe(GREETING);
  });

  it('is an MP3 that exists and is not empty', () => {
    const bytes = readFileSync(MP3);
    expect(statSync(MP3).size).toBeGreaterThan(1000);
    const id3 = bytes.subarray(0, 3).toString('latin1') === 'ID3';
    const frameSync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
    expect(id3 || frameSync, 'not MP3 data').toBe(true);
  });

  it('says what it is: the text, the voice, the model and the format it was made with, and when', () => {
    expect(Object.keys(sidecar)).toEqual(['text', 'voiceId', 'modelId', 'format', 'generatedAt']);
    for (const key of ['text', 'voiceId', 'modelId', 'format', 'generatedAt']) {
      expect(typeof sidecar[key], key).toBe('string');
      expect((sidecar[key] as string).length, key).toBeGreaterThan(0);
    }
    expect(sidecar.format).toMatch(/^mp3_/);
    expect(Number.isNaN(Date.parse(sidecar.generatedAt as string))).toBe(false);
  });

  it('is served from where the widget plays it', () => {
    expect(GREETING_URL).toBe('/concierge/greeting.mp3');
    expect(MP3.endsWith(join('public', GREETING_URL))).toBe(true);
  });

  it('is explained in the privacy page, in the voice paragraph that names ElevenLabs', () => {
    const html = readFileSync(join(PUBLIC, 'privacy.html'), 'utf8');
    const paragraph = html.split('\n').find((line) => line.includes('Voice (optional)')) ?? '';
    expect(paragraph).toContain('ElevenLabs');
    for (const sentence of [
      // opening the chat turns spoken replies on, so reply text goes to ElevenLabs even if the mic is never used
      'Where spoken replies are available, opening the chat plays a short greeting and turns spoken replies on, whether or not you ever use the microphone.',
      'The greeting is a recording served from this site, and nothing is sent anywhere to play it.',
      'While spoken replies are on, the text of each reply is sent to ElevenLabs',
      // the page-load /health request
      'When the page loads, it also makes one small availability check to our chat service, to learn whether spoken replies are offered; the request contains nothing from the chat.',
    ]) {
      expect(paragraph.split(sentence), sentence).toHaveLength(2);
    }
  });
});
