/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guards for the files the analytics rollout edits outside the TypeScript:
// the build script, the privacy text and the public env files.
const ROOT = join(import.meta.dirname, '..', '..');

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

// KEY=value lines only; comments and blank lines are ignored.
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2];
  }
  return out;
}

describe('package.json build script', () => {
  it('runs the postbuild step last, after tsc and vite build', () => {
    const build = (JSON.parse(read('package.json')) as { scripts: { build: string } }).scripts.build;
    expect(build.endsWith('node scripts/postbuild.mjs')).toBe(true);
    expect(build).toBe('tsc -b && vite build && node scripts/postbuild.mjs');
  });
});

describe('public/privacy.html section 5', () => {
  const SENTENCE =
    'We use Google Analytics and Cloudflare Web Analytics to count visits and see which pages people use. ' +
    'No personal information is collected, advertising features are turned off, and if your browser sends a ' +
    'Do Not Track or Global Privacy Control signal, analytics does not load.';

  it('has the analytics sentence exactly once', () => {
    const html = read('public/privacy.html');
    expect(html.split(SENTENCE)).toHaveLength(2);
  });

  it('has it inside "5. Cookies and tracking", appended to the existing paragraph', () => {
    const html = read('public/privacy.html');
    const start = html.indexOf('<h2>5. Cookies and tracking</h2>');
    const end = html.indexOf('<h2 id="sms-consent">');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = html.slice(start, end);
    expect(section).toContain(SENTENCE);
    // Same paragraph as the existing cookies text, not a new one.
    expect(section.match(/<p>/g)).toHaveLength(1);
    expect(section).toContain('Disabling cookies may affect your ability to use some features. ' + SENTENCE);
  });
});

// G-XXXXXXX means "off". The real Measurement ID and beacon token may go into
// .env.production at launch, so that file accepts either; development must stay off.
describe('analytics env files', () => {
  const PLACEHOLDER = { VITE_GA4_ID: 'G-XXXXXXX', VITE_GA4_DEBUG: '', VITE_CF_BEACON_TOKEN: '' };

  it('.env.production has the three keys: ID is the placeholder or a real G- ID, debug is off, token is empty or 32 hex characters', () => {
    const env = parseEnv(read('.env.production'));
    for (const key of Object.keys(PLACEHOLDER)) {
      expect(env, `.env.production defines ${key}`).toHaveProperty(key);
    }
    expect(env.VITE_GA4_ID).toMatch(/^G-(XXXXXXX|[A-Z0-9]{6,12})$/);
    expect(env.VITE_GA4_DEBUG).toBe('');
    expect(env.VITE_CF_BEACON_TOKEN).toMatch(/^([a-f0-9]{32})?$/);
  });

  it('.env.development has the three keys with the placeholder/empty values', () => {
    const env = parseEnv(read('.env.development'));
    for (const [key, value] of Object.entries(PLACEHOLDER)) {
      expect(env, `.env.development defines ${key}`).toHaveProperty(key);
      expect(env[key], `.env.development ${key}`).toBe(value);
    }
  });

  it('keeps the existing concierge keys', () => {
    expect(parseEnv(read('.env.production'))).toHaveProperty('VITE_CONCIERGE_API_URL');
    expect(parseEnv(read('.env.development'))).toHaveProperty('VITE_TURNSTILE_SITE_KEY');
  });
});
