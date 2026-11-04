import { describe, expect, it } from 'vitest';
import { EMPTY_LEAD_DRAFT, hasNewDetail, mergeLeadDraft, parseLeadDraft } from '../leadDraft';
import type { LeadDraft } from '../types';

const full: LeadDraft = {
  name: 'Jane Doe',
  phone: '7705550147',
  email: 'jane@example.com',
  business: 'Doe Plumbing',
  need: 'missed after-hours calls',
  callbackWindow: 'afternoon_1_3',
};

describe('parseLeadDraft', () => {
  it('passes a clean lead through unchanged', () => {
    expect(parseLeadDraft(full)).toEqual(full);
  });

  it('turns anything that is not an object into an empty draft', () => {
    for (const bad of [undefined, null, 'lead', 7, true, [], [1, 2]]) {
      expect(parseLeadDraft(bad)).toEqual(EMPTY_LEAD_DRAFT);
    }
  });

  it('treats missing fields as empty strings', () => {
    expect(parseLeadDraft({ name: 'Dana Lee' })).toEqual({ ...EMPTY_LEAD_DRAFT, name: 'Dana Lee' });
  });

  it('ignores fields of the wrong type', () => {
    expect(
      parseLeadDraft({ name: 42, phone: ['7705550147'], email: null, business: {}, need: false, callbackWindow: 3 })
    ).toEqual(EMPTY_LEAD_DRAFT);
  });

  it('trims whitespace', () => {
    expect(parseLeadDraft({ ...full, name: '  Jane Doe ', business: ' Doe Plumbing\n' })).toMatchObject({
      name: 'Jane Doe',
      business: 'Doe Plumbing',
    });
  });

  it('normalizes a phone number to 10 digits, or drops it', () => {
    expect(parseLeadDraft({ phone: '(770) 555-0147' }).phone).toBe('7705550147');
    expect(parseLeadDraft({ phone: '1-770-555-0147' }).phone).toBe('7705550147');
    expect(parseLeadDraft({ phone: '77055501' }).phone).toBe('');
    expect(parseLeadDraft({ phone: 'call me' }).phone).toBe('');
  });

  it('drops an email that would not pass the form', () => {
    expect(parseLeadDraft({ email: 'jane@example.com' }).email).toBe('jane@example.com');
    expect(parseLeadDraft({ email: 'not-an-email' }).email).toBe('');
    expect(parseLeadDraft({ email: 'a@b.c' }).email).toBe('');
  });

  it('accepts only the four callback windows', () => {
    for (const w of ['morning_9_11', 'midday_11_1', 'afternoon_1_3', 'late_afternoon_3_5']) {
      expect(parseLeadDraft({ callbackWindow: w }).callbackWindow).toBe(w);
    }
    expect(parseLeadDraft({ callbackWindow: 'evening' }).callbackWindow).toBe('');
    expect(parseLeadDraft({ callbackWindow: '' }).callbackWindow).toBe('');
  });

  it('drops an over-long email instead of cutting it into a different address', () => {
    const long = `${'a'.repeat(250)}@example.com`; // 262 characters
    expect(parseLeadDraft({ email: long }).email).toBe('');
    const exactly254 = `${'a'.repeat(254 - '@b.co'.length)}@b.co`;
    expect(exactly254).toHaveLength(254);
    expect(parseLeadDraft({ email: exactly254 }).email).toBe(exactly254);
  });

  it('clamps long values to the form limits', () => {
    const out = parseLeadDraft({ name: 'n'.repeat(200), business: 'b'.repeat(300), need: 'x'.repeat(900) });
    expect(out.name).toHaveLength(80);
    expect(out.business).toHaveLength(120);
    expect(out.need).toHaveLength(500);
  });
});

describe('mergeLeadDraft', () => {
  it('adds new details to what was gathered before', () => {
    const merged = mergeLeadDraft({ ...EMPTY_LEAD_DRAFT, name: 'Dana Lee' }, { ...EMPTY_LEAD_DRAFT, phone: '7705550147' });
    expect(merged).toEqual({ ...EMPTY_LEAD_DRAFT, name: 'Dana Lee', phone: '7705550147' });
  });

  it('never erases a detail because a later reply left it empty', () => {
    expect(mergeLeadDraft(full, EMPTY_LEAD_DRAFT)).toEqual(full);
  });

  it('lets a later non-empty value correct an earlier one', () => {
    expect(mergeLeadDraft(full, { ...EMPTY_LEAD_DRAFT, phone: '4045550100' }).phone).toBe('4045550100');
  });

  it('keeps visitor-locked fields: the model cannot overwrite them with a different value', () => {
    const locked = new Set<keyof LeadDraft>(['phone', 'business']);
    const merged = mergeLeadDraft(
      { ...EMPTY_LEAD_DRAFT, name: 'Dana Lee', phone: '4045550100', business: 'Lee Lawn and Garden' },
      { ...EMPTY_LEAD_DRAFT, name: 'Dana L. Lee', phone: '7705550147', business: 'Lee Landscaping', need: 'calls' },
      locked
    );
    expect(merged).toEqual({
      ...EMPTY_LEAD_DRAFT,
      name: 'Dana L. Lee', // not locked: the model's later value wins
      phone: '4045550100', // locked
      business: 'Lee Lawn and Garden', // locked
      need: 'calls', // new detail in an unlocked field
    });
  });

  it('a locked field the model fills for the first time stays as the visitor left it, even if empty', () => {
    const merged = mergeLeadDraft(EMPTY_LEAD_DRAFT, { ...EMPTY_LEAD_DRAFT, phone: '7705550147' }, new Set(['phone']));
    expect(merged.phone).toBe('');
  });

  it('returns a new object and leaves its inputs alone', () => {
    const base = { ...full };
    const merged = mergeLeadDraft(base, { ...EMPTY_LEAD_DRAFT, need: 'new' });
    expect(merged).not.toBe(base);
    expect(base.need).toBe('missed after-hours calls');
  });
});

describe('EMPTY_LEAD_DRAFT', () => {
  it('is all empty strings', () => {
    expect(EMPTY_LEAD_DRAFT).toEqual({ name: '', phone: '', email: '', business: '', need: '', callbackWindow: '' });
  });
});

describe('hasNewDetail', () => {
  it('ignores the fields it is told to (visitor-edited ones)', () => {
    const incoming = { ...full, phone: '4045550100' };
    expect(hasNewDetail(full, incoming)).toBe(true);
    expect(hasNewDetail(full, incoming, new Set(['phone']))).toBe(false);
    expect(hasNewDetail(full, { ...incoming, need: 'something new' }, new Set(['phone']))).toBe(true);
  });

  it('is false for the same details again', () => {
    expect(hasNewDetail(full, full)).toBe(false);
  });

  it('is false when the reply carries fewer details, or none (empty fields are not changes)', () => {
    expect(hasNewDetail(full, { ...EMPTY_LEAD_DRAFT, name: 'Jane Doe' })).toBe(false);
    expect(hasNewDetail(full, EMPTY_LEAD_DRAFT)).toBe(false);
  });

  it('is true when a non-empty field differs from what was gathered', () => {
    expect(hasNewDetail(full, { ...full, phone: '4045550100' })).toBe(true);
    expect(hasNewDetail(full, { ...full, name: 'Jane Q. Doe' })).toBe(true);
    expect(hasNewDetail(full, { ...EMPTY_LEAD_DRAFT, callbackWindow: 'morning_9_11' })).toBe(true);
  });

  it('is true when a detail is added that was not gathered before', () => {
    const before = { ...full, need: '' };
    expect(hasNewDetail(before, full)).toBe(true);
    expect(hasNewDetail(EMPTY_LEAD_DRAFT, { ...EMPTY_LEAD_DRAFT, email: 'jane@example.com' })).toBe(true);
  });
});
