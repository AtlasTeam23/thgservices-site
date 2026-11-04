import { describe, expect, it } from 'vitest';
import {
  buildTranscript,
  formatPhone,
  LIMITS,
  normalizePhone,
  sanitizeUtm,
  validateLead,
  type LeadFormValues,
} from '../validation';
import type { Message } from '../types';

const valid: LeadFormValues = {
  name: 'Jane Doe',
  phone: '(770) 555-1234',
  email: '',
  business: 'Doe Plumbing',
  need: '',
  callbackWindow: 'morning_9_11',
  consent: true,
};

const fieldsFor = (patch: Partial<LeadFormValues>) => {
  const res = validateLead({ ...valid, ...patch });
  return res.ok ? null : res.fields;
};

describe('normalizePhone', () => {
  it('accepts common US formats and returns 10 digits', () => {
    expect(normalizePhone('(770) 555-1234')).toBe('7705551234');
    expect(normalizePhone('1-770-555-1234')).toBe('7705551234');
    expect(normalizePhone('+1 770 555 1234')).toBe('7705551234');
    expect(normalizePhone('770.555.1234')).toBe('7705551234');
    expect(normalizePhone('7705551234')).toBe('7705551234');
  });

  it('drops a leading 1 only when there are 11 digits', () => {
    expect(normalizePhone('17705551234')).toBe('7705551234');
    expect(normalizePhone('27705551234')).toBeNull();
  });

  it('rejects anything that is not exactly 10 digits after stripping', () => {
    expect(normalizePhone('770555123')).toBeNull();
    expect(normalizePhone('77055512345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('call me')).toBeNull();
  });
});

describe('validateLead', () => {
  it('accepts a valid lead and normalizes it', () => {
    const res = validateLead(valid);
    expect(res).toEqual({
      ok: true,
      value: {
        name: 'Jane Doe',
        phone: '7705551234',
        business: 'Doe Plumbing',
        callbackWindow: 'morning_9_11',
        consent: true,
      },
    });
  });

  it('trims fields and keeps optional email and need only when present', () => {
    const res = validateLead({
      ...valid,
      name: '  Jane  ',
      email: ' jane@example.com ',
      need: ' Missed calls ',
      business: ' Doe Plumbing ',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.name).toBe('Jane');
      expect(res.value.email).toBe('jane@example.com');
      expect(res.value.need).toBe('Missed calls');
      expect(res.value.business).toBe('Doe Plumbing');
    }
  });

  it('requires a name of 1-80 characters', () => {
    expect(fieldsFor({ name: '' })?.name).toBeTruthy();
    expect(fieldsFor({ name: '   ' })?.name).toBeTruthy();
    expect(fieldsFor({ name: 'a'.repeat(80) })).toBeNull();
    expect(fieldsFor({ name: 'a'.repeat(81) })?.name).toBeTruthy();
  });

  it('uses the contract message for a bad phone', () => {
    expect(fieldsFor({ phone: '770555123' })?.phone).toBe(
      'Enter a 10-digit US phone number'
    );
    expect(fieldsFor({ phone: '' })?.phone).toBe(
      'Enter a 10-digit US phone number'
    );
  });

  it('treats email as optional but validates it when present', () => {
    expect(fieldsFor({ email: '' })).toBeNull();
    expect(fieldsFor({ email: 'a@b.co' })).toBeNull();
    expect(fieldsFor({ email: 'a@b.c' })?.email).toBeTruthy();
    expect(fieldsFor({ email: 'no-at-sign.com' })?.email).toBeTruthy();
    expect(fieldsFor({ email: 'two words@b.com' })?.email).toBeTruthy();
    expect(fieldsFor({ email: 'a@@b.com' })?.email).toBeTruthy();
  });

  it('requires a business of 1-120 characters', () => {
    expect(fieldsFor({ business: '' })?.business).toBeTruthy();
    expect(fieldsFor({ business: 'b'.repeat(120) })).toBeNull();
    expect(fieldsFor({ business: 'b'.repeat(121) })?.business).toBeTruthy();
  });

  it('caps need at 500 characters', () => {
    expect(fieldsFor({ need: 'n'.repeat(500) })).toBeNull();
    expect(fieldsFor({ need: 'n'.repeat(501) })?.need).toBeTruthy();
  });

  it('only accepts the four callback windows', () => {
    for (const w of [
      'morning_9_11',
      'midday_11_1',
      'afternoon_1_3',
      'late_afternoon_3_5',
    ]) {
      expect(fieldsFor({ callbackWindow: w })).toBeNull();
    }
    expect(fieldsFor({ callbackWindow: '' })?.callbackWindow).toBeTruthy();
    expect(fieldsFor({ callbackWindow: 'evening' })?.callbackWindow).toBeTruthy();
  });

  it('requires consent', () => {
    expect(fieldsFor({ consent: false })?.consent).toBeTruthy();
  });

  it('reports every failing field at once', () => {
    const fields = fieldsFor({
      name: '',
      phone: '1',
      business: '',
      callbackWindow: '',
      consent: false,
    });
    expect(Object.keys(fields ?? {}).sort()).toEqual([
      'business',
      'callbackWindow',
      'consent',
      'name',
      'phone',
    ]);
  });
});

describe('buildTranscript', () => {
  const msg = (over: Partial<Message> & Pick<Message, 'role' | 'content'>): Message => ({
    id: Math.random().toString(36),
    at: '2026-11-03T15:00:00.000Z',
    ...over,
  });

  it('drops the local greeting and keeps role, content and timestamp', () => {
    const out = buildTranscript([
      msg({ role: 'assistant', content: 'Hi there!', greeting: true }),
      msg({ role: 'user', content: 'What do you do?' }),
      msg({ role: 'assistant', content: 'We help.', callLink: true }),
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'What do you do?', at: '2026-11-03T15:00:00.000Z' },
      { role: 'assistant', content: 'We help.', at: '2026-11-03T15:00:00.000Z' },
    ]);
  });

  it('keeps only the most recent 60 entries', () => {
    const many = Array.from({ length: 75 }, (_, i) =>
      msg({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })
    );
    const out = buildTranscript(many);
    expect(out).toHaveLength(60);
    expect(out[0].content).toBe('m15');
    expect(out[59].content).toBe('m74');
  });

  it('clamps each entry to 1,000 characters', () => {
    const out = buildTranscript([msg({ role: 'assistant', content: 'x'.repeat(1500) })]);
    expect(out[0].content).toHaveLength(1000);
  });
});

describe('sanitizeUtm', () => {
  it('keeps only utm_ keys with string values', () => {
    expect(
      sanitizeUtm({ utm_source: 'google', ref: 'x', utm_medium: 'cpc', other: 'y' })
    ).toEqual({ utm_source: 'google', utm_medium: 'cpc' });
  });

  it('keeps at most 10 keys and truncates values to 100 characters', () => {
    const raw: Record<string, string> = {};
    for (let i = 0; i < 14; i += 1) raw[`utm_k${i}`] = 'v'.repeat(150);
    const out = sanitizeUtm(raw);
    expect(Object.keys(out)).toHaveLength(10);
    expect(Object.values(out).every((v) => v.length === 100)).toBe(true);
  });
});

describe('formatPhone', () => {
  it('shows exactly 10 digits as (770) 555-0147', () => {
    expect(formatPhone('7705550147')).toBe('(770) 555-0147');
  });

  it('leaves anything else as it is, so a half-typed or odd value is never mangled', () => {
    for (const odd of ['', '77055', '770555014', '17705550147', '(770) 555-0147', 'call me']) {
      expect(formatPhone(odd)).toBe(odd);
    }
  });

  it('round-trips through normalizePhone', () => {
    expect(normalizePhone(formatPhone('7705550147'))).toBe('7705550147');
  });
});

describe('LIMITS', () => {
  it('has the email limit used when cleaning model output', () => {
    expect(LIMITS.emailMax).toBe(254);
  });
});
