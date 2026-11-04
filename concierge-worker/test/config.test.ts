import { describe, expect, it } from 'vitest';
import wranglerText from '../wrangler.jsonc?raw';

// The deployed settings live in wrangler.jsonc, but the test suite overrides LLM_PROVIDER to
// "mock" (vitest.config.ts), so nothing else would notice if the committed file said "mock".

/** Parses JSONC: removes // and /* *\/ comments outside strings, and trailing commas. */
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

describe('wrangler.jsonc', () => {
  it('parses, and the parser handles the comments in it', () => {
    expect(config.name).toBe('thg-concierge');
    expect(parseJsonc('{ // note\n "a": "x//y", /* c */ "b": [1, 2,], }')).toEqual({ a: 'x//y', b: [1, 2] });
  });

  it('deploys with the real provider and the contracted model, not the test mock', () => {
    expect(config.vars.LLM_PROVIDER).toBe('anthropic');
    expect(config.vars.MODEL).toBe('claude-haiku-5-5');
  });

  it('carries the contracted public vars', () => {
    expect(config.vars).toMatchObject({
      DAILY_LLM_CAP: '2000',
      LEAD_TO_EMAIL: 'developer@leadquik.com',
      LEAD_FROM_EMAIL: 'THG AI Services <concierge@leadquik.com>',
    });
    expect(config.vars.ALLOWED_ORIGINS.split(',')).toEqual([
      'https://thgservices.io',
      'https://www.thgservices.io',
      'http://localhost:3000',
      'http://localhost:4173',
    ]);
    expect(config.vars.RATE_SALT).toMatch(/^[0-9a-f]{32}$/);
  });

  it('never puts a secret in the committed vars', () => {
    for (const secret of ['LLM_API_KEY', 'RESEND_API_KEY', 'TURNSTILE_SECRET_KEY', 'LEADQUIK_WEBHOOK_URL']) {
      expect(config.vars, secret).not.toHaveProperty(secret);
    }
    expect(JSON.stringify(config.vars)).not.toMatch(/sk-ant|re_[A-Za-z0-9]{16}|whsec_/);
  });

  it('binds the SQLite-backed Limiter Durable Object', () => {
    expect(config.durable_objects.bindings).toEqual([{ name: 'LIMITER', class_name: 'Limiter' }]);
    expect(config.migrations).toEqual([{ tag: 'v1', new_sqlite_classes: ['Limiter'] }]);
  });

  it('enables nodejs_compat and imports markdown as text', () => {
    expect(config.compatibility_flags).toContain('nodejs_compat');
    expect(config.rules).toEqual([{ type: 'Text', globs: ['**/*.md'], fallthrough: true }]);
  });

  it('keeps application logs but turns off per-request invocation logs, which record client IPs', () => {
    expect(config.observability.enabled).toBe(true);
    expect(config.observability.logs).toMatchObject({ enabled: true, invocation_logs: false });
  });
});
