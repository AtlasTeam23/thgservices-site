import { describe, expect, it } from 'vitest';
import {
  CALLBACK_WINDOWS,
  MESSAGES,
  isValidEmail,
  normalizePhone,
  selectRecentTurns,
  validateChat,
  validateLead,
} from '../src/validation';

const SESSION = '3f2b8c1e-5d4a-4e7b-9a10-0c1d2e3f4a5b';

const validLead = (overrides: Record<string, unknown> = {}) => ({
  sessionId: SESSION,
  name: 'Jane Doe',
  phone: '(770) 555-1234',
  email: 'jane@example.com',
  business: 'Doe Plumbing',
  need: 'Missed calls after hours',
  callbackWindow: 'morning_9_11',
  consent: true,
  transcript: [
    { role: 'user', content: 'What do you do?', at: '2026-11-03T15:00:00.000Z' },
    { role: 'assistant', content: 'We help local businesses save time with AI.', at: '2026-11-03T15:00:04.000Z' },
  ],
  page: { url: 'https://thgservices.io/#ai-concierge', utm: { utm_source: 'google' } },
  ...overrides,
});

describe('normalizePhone', () => {
  it.each([
    ['(770) 555-1234', '7705551234'],
    ['770.555.1234', '7705551234'],
    ['1-770-555-1234', '7705551234'],
    ['+1 (770) 555-1234', '7705551234'],
    ['7705551234', '7705551234'],
  ])('accepts %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['770555123', '770-555-12345', '2-770-555-1234', '', 'call me', '770-555-1234 ext 5'])(
    'rejects %j',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe('isValidEmail', () => {
  it.each(['jane@example.com', 'a.b+c@sub.example.co', 'x@y.io'])('accepts %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    'jane@example',
    'jane@example.c',
    'jane example@x.com',
    '@x.com',
    'jane@',
    'a@@b.com',
    '',
    // characters that could split one address into several, or break out of a header or a link
    'jane@example.com,evil@example.org',
    'jane@example.com;evil@example.org',
    'Jane <jane@example.com>',
    'jane@example.com>',
    '<jane@example.com',
    '"jane"@example.com',
    'jane@exam"ple.com',
    'jane@example.com\n',
    'jane@example.c,om',
  ])(
    'rejects %j',
    (email) => {
      expect(isValidEmail(email)).toBe(false);
    },
  );
});

describe('validateLead', () => {
  it('accepts a complete lead and normalizes it', () => {
    const result = validateLead(validLead());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      sessionId: SESSION,
      name: 'Jane Doe',
      phone: '7705551234',
      email: 'jane@example.com',
      business: 'Doe Plumbing',
      need: 'Missed calls after hours',
      callbackWindow: 'morning_9_11',
      consent: true,
    });
    expect(result.value.transcript).toHaveLength(2);
    expect(result.value.page).toEqual({
      url: 'https://thgservices.io/#ai-concierge',
      utm: { utm_source: 'google' },
    });
  });

  it('allows email and need to be omitted or blank', () => {
    const result = validateLead(validLead({ email: '', need: undefined }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.email).toBeUndefined();
      expect(result.value.need).toBe('');
    }
  });

  it('defaults a missing transcript and page', () => {
    const result = validateLead(validLead({ transcript: undefined, page: undefined }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.transcript).toEqual([]);
      expect(result.value.page).toEqual({ url: '', utm: {} });
    }
  });

  it('reports a per-field message for every problem at once', () => {
    const result = validateLead(
      validLead({
        name: '   ',
        phone: '770555123',
        email: 'nope',
        business: '',
        callbackWindow: 'evening',
        consent: false,
      }),
    );
    expect(result).toEqual({
      ok: false,
      fields: {
        name: MESSAGES.nameRequired,
        phone: 'Enter a 10-digit US phone number',
        email: MESSAGES.emailInvalid,
        business: MESSAGES.businessRequired,
        callbackWindow: MESSAGES.callbackWindowRequired,
        consent: MESSAGES.consentRequired,
      },
    });
  });

  it('requires consent to be exactly true (not "true", 1 or missing)', () => {
    for (const consent of ['true', 1, undefined, null]) {
      const result = validateLead(validLead({ consent }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields.consent).toBe(MESSAGES.consentRequired);
    }
  });

  it('accepts every callback window and rejects anything else', () => {
    for (const callbackWindow of CALLBACK_WINDOWS) {
      expect(validateLead(validLead({ callbackWindow })).ok).toBe(true);
    }
    expect(CALLBACK_WINDOWS).toEqual(['morning_9_11', 'midday_11_1', 'afternoon_1_3', 'late_afternoon_3_5']);
    expect(validateLead(validLead({ callbackWindow: 'morning' })).ok).toBe(false);
  });

  it('enforces field length limits (name 80, business 120, need 500)', () => {
    expect(validateLead(validLead({ name: 'a'.repeat(80) })).ok).toBe(true);
    expect(validateLead(validLead({ name: 'a'.repeat(81) })).ok).toBe(false);
    expect(validateLead(validLead({ business: 'b'.repeat(120) })).ok).toBe(true);
    expect(validateLead(validLead({ business: 'b'.repeat(121) })).ok).toBe(false);
    expect(validateLead(validLead({ need: 'n'.repeat(500) })).ok).toBe(true);
    const tooLong = validateLead(validLead({ need: 'n'.repeat(501) }));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.fields.need).toBe(MESSAGES.needTooLong);
  });

  it('strips HTML and control characters and keeps names on one line', () => {
    const result = validateLead(validLead({ name: 'Jane\r\n<b>Doe</b>\u0000', business: 'Doe\nPlumbing' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('Jane Doe');
      expect(result.value.business).toBe('Doe Plumbing');
    }
  });

  it('limits the transcript to 60 entries of at most 1,000 characters', () => {
    const entry = { role: 'user', content: 'hi', at: '2026-11-03T15:00:00.000Z' };
    expect(validateLead(validLead({ transcript: Array(60).fill(entry) })).ok).toBe(true);
    const tooMany = validateLead(validLead({ transcript: Array(61).fill(entry) }));
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.fields.transcript).toBeDefined();

    expect(validateLead(validLead({ transcript: [{ ...entry, content: 'x'.repeat(1000) }] })).ok).toBe(true);
    expect(validateLead(validLead({ transcript: [{ ...entry, content: 'x'.repeat(1001) }] })).ok).toBe(false);
  });

  it('rejects transcript entries with an unknown role', () => {
    const result = validateLead(validLead({ transcript: [{ role: 'system', content: 'x', at: '' }] }));
    expect(result.ok).toBe(false);
  });

  it('keeps an unparseable timestamp as an empty string instead of losing the lead', () => {
    const result = validateLead(validLead({ transcript: [{ role: 'user', content: 'hi', at: 'yesterday-ish' }] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.transcript[0]?.at).toBe('');
  });

  it('limits page.url to 500 characters', () => {
    expect(validateLead(validLead({ page: { url: 'https://x.io/' + 'a'.repeat(487), utm: {} } })).ok).toBe(true);
    const tooLong = validateLead(validLead({ page: { url: 'https://x.io/' + 'a'.repeat(488), utm: {} } }));
    expect(tooLong.ok).toBe(false);
  });

  it('keeps only utm_ keys, at most 10, each value at most 100 characters', () => {
    const kept = validateLead(
      validLead({ page: { url: 'https://thgservices.io/', utm: { utm_source: 'g', utm_medium: 'cpc', ref: 'x', fbclid: 'y' } } }),
    );
    expect(kept.ok).toBe(true);
    if (kept.ok) expect(kept.value.page.utm).toEqual({ utm_source: 'g', utm_medium: 'cpc' });

    const ten = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`utm_k${i}`, 'v']));
    expect(validateLead(validLead({ page: { url: '', utm: ten } })).ok).toBe(true);
    const eleven = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`utm_k${i}`, 'v']));
    expect(validateLead(validLead({ page: { url: '', utm: eleven } })).ok).toBe(false);

    expect(validateLead(validLead({ page: { url: '', utm: { utm_source: 'a'.repeat(100) } } })).ok).toBe(true);
    expect(validateLead(validLead({ page: { url: '', utm: { utm_source: 'a'.repeat(101) } } })).ok).toBe(false);
  });

  it('does not count non-utm keys toward the 10-key limit', () => {
    const utm: Record<string, string> = { ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`other${i}`, 'v'])), utm_source: 'g' };
    const result = validateLead(validLead({ page: { url: '', utm } }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.page.utm).toEqual({ utm_source: 'g' });
  });

  it('rejects a bad session id and non-object bodies', () => {
    const bad = validateLead(validLead({ sessionId: 'not-a-uuid' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.fields.sessionId).toBeDefined();
    for (const body of [null, 'x', 42, [], undefined]) {
      expect(validateLead(body)).toMatchObject({ ok: false });
    }
  });

  it('passes through a Turnstile token only when it is a reasonable string', () => {
    const ok = validateLead(validLead({ turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' }));
    expect(ok.ok && ok.value.turnstileToken).toBe('XXXX.DUMMY.TOKEN.XXXX');
    const huge = validateLead(validLead({ turnstileToken: 'x'.repeat(5000) }));
    expect(huge.ok && huge.value.turnstileToken).toBeUndefined();
  });
});

const turns = (n: number, last: 'user' | 'assistant' = 'user') =>
  Array.from({ length: n }, (_, i) => ({
    role: (n - 1 - i) % 2 === 0 ? last : last === 'user' ? 'assistant' : 'user',
    content: `m${i}`,
  }));

describe('validateChat', () => {
  const base = (overrides: Record<string, unknown> = {}) => ({
    sessionId: SESSION,
    messages: [{ role: 'user', content: 'What do you do?' }],
    ...overrides,
  });

  it('accepts a normal request', () => {
    const result = validateChat(base({ turnstileToken: 'tok' }));
    expect(result).toEqual({
      ok: true,
      value: { sessionId: SESSION, messages: [{ role: 'user', content: 'What do you do?' }], turnstileToken: 'tok' },
    });
  });

  it('requires the last message to be from the user', () => {
    expect(validateChat(base({ messages: turns(2, 'assistant') }))).toEqual({ ok: false, error: 'bad_request' });
  });

  it('rejects empty, non-array, oversized or malformed message lists', () => {
    for (const messages of [[], 'hi', null, turns(26), [{ role: 'user' }], [{ role: 'system', content: 'x' }], [{ role: 'user', content: 5 }]]) {
      expect(validateChat(base({ messages }))).toEqual({ ok: false, error: 'bad_request' });
    }
    expect(validateChat(base({ messages: turns(25) })).ok).toBe(true);
  });

  it('rejects a bad session id and non-object bodies', () => {
    expect(validateChat(base({ sessionId: 'x' }))).toEqual({ ok: false, error: 'bad_request' });
    expect(validateChat(null)).toEqual({ ok: false, error: 'bad_request' });
    expect(validateChat('hello')).toEqual({ ok: false, error: 'bad_request' });
  });

  it('rejects a 1,500-character user message as too long, and accepts exactly 1,000', () => {
    expect(validateChat(base({ messages: [{ role: 'user', content: 'a'.repeat(1500) }] }))).toEqual({
      ok: false,
      error: 'message_too_long',
    });
    expect(validateChat(base({ messages: [{ role: 'user', content: 'a'.repeat(1001) }] }))).toMatchObject({
      error: 'message_too_long',
    });
    expect(validateChat(base({ messages: [{ role: 'user', content: 'a'.repeat(1000) }] })).ok).toBe(true);
  });

  it('measures length after stripping HTML, so tags do not count against the limit', () => {
    const content = '<b>' + 'a'.repeat(1000) + '</b>';
    expect(validateChat(base({ messages: [{ role: 'user', content }] })).ok).toBe(true);
  });

  it('strips HTML and control characters from every message', () => {
    const result = validateChat(
      base({
        messages: [
          { role: 'user', content: '<b>Hi</b>\u0000 there' },
          { role: 'assistant', content: 'Hello<script>x</script>' },
          { role: 'user', content: 'ok' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.messages.map((m) => m.content)).toEqual(['Hi there', 'Hellox', 'ok']);
    }
  });

  it('rejects a last message that is empty once sanitized', () => {
    expect(validateChat(base({ messages: [{ role: 'user', content: '<b></b>  ' }] }))).toEqual({
      ok: false,
      error: 'bad_request',
    });
  });

  it('silently drops empty earlier messages and clamps over-long assistant messages', () => {
    const result = validateChat(
      base({
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: '<i></i>' },
          { role: 'assistant', content: 'z'.repeat(5000) },
          { role: 'user', content: 'second' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.messages).toHaveLength(3);
      expect(result.value.messages[1]?.content).toHaveLength(2000);
    }
  });
});

describe('raw length guard (4x the field limit, checked before sanitizing)', () => {
  const chatBody = (content: string, role: 'user' | 'assistant' = 'user') => ({
    sessionId: SESSION,
    messages: role === 'user' ? [{ role, content }] : [{ role: 'user', content: 'hi' }, { role, content: 'x' }, { role: 'user', content: 'again' }],
  });

  it('treats a user message over 4,000 raw characters as too long even if it is mostly markup', () => {
    const markup = '<i>'.repeat(1334); // 4,002 characters that sanitize down to nothing
    expect(validateChat(chatBody(markup + 'hello'))).toEqual({ ok: false, error: 'message_too_long' });
  });

  it('still accepts a message of exactly 4,000 raw characters that sanitizes to something short', () => {
    const markup = '<i>'.repeat(1333) + 'a'; // 4,000 characters
    expect(markup).toHaveLength(4000);
    expect(validateChat(chatBody(markup))).toMatchObject({ ok: true });
  });

  it('rejects an assistant message over 8,000 raw characters', () => {
    const result = validateChat({
      sessionId: SESSION,
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '<i>'.repeat(2667) },
        { role: 'user', content: 'again' },
      ],
    });
    expect(result).toEqual({ ok: false, error: 'bad_request' });
  });

  it('rejects over-long raw lead fields with the field message, without sanitizing them first', () => {
    const lead = (overrides: Record<string, unknown>) => ({
      sessionId: SESSION,
      name: 'Jane Doe',
      phone: '7705551234',
      business: 'Doe Plumbing',
      callbackWindow: 'morning_9_11',
      consent: true,
      ...overrides,
    });
    const name = validateLead(lead({ name: '<i>'.repeat(110) })); // 330 raw > 4 x 80
    expect(name).toMatchObject({ ok: false, fields: { name: MESSAGES.nameTooLong } });
    const business = validateLead(lead({ business: '<i>'.repeat(170) })); // 510 raw > 4 x 120
    expect(business).toMatchObject({ ok: false, fields: { business: MESSAGES.businessTooLong } });
    const need = validateLead(lead({ need: '<i>'.repeat(700) })); // 2,100 raw > 4 x 500
    expect(need).toMatchObject({ ok: false, fields: { need: MESSAGES.needTooLong } });
    const transcript = validateLead(lead({ transcript: [{ role: 'user', content: '<i>'.repeat(1400), at: '' }] })); // 4,200 raw > 4 x 1,000
    expect(transcript).toMatchObject({ ok: false, fields: { transcript: MESSAGES.transcriptInvalid } });
  });

  it('still accepts markup-heavy fields that stay under 4x the limit', () => {
    const result = validateLead({
      sessionId: SESSION,
      name: '<b>Jane</b> Doe',
      phone: '7705551234',
      business: '<i>Doe</i> Plumbing',
      callbackWindow: 'morning_9_11',
      consent: true,
      transcript: [{ role: 'user', content: '<b>' + 'a'.repeat(900) + '</b>', at: '' }],
    });
    expect(result.ok).toBe(true);
  });

  it('does not run the tag pattern on hostile input at all', () => {
    const started = performance.now();
    const result = validateChat(chatBody('<a'.repeat(30_000)));
    expect(result).toEqual({ ok: false, error: 'message_too_long' });
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe('selectRecentTurns', () => {
  const thread = (userCount: number) =>
    Array.from({ length: userCount * 2 - 1 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m${i}`,
    }));

  it('keeps everything when there are 12 or fewer user turns', () => {
    const messages = thread(12);
    expect(selectRecentTurns(messages)).toEqual(messages);
  });

  it('keeps only the last 12 user turns (a full 25-entry thread loses its first pair)', () => {
    const messages = thread(13); // 13 user + 12 assistant = 25 entries
    expect(messages).toHaveLength(25);
    const kept = selectRecentTurns(messages);
    expect(kept).toHaveLength(23);
    expect(kept[0]).toEqual({ role: 'user', content: 'm2' });
    expect(kept.at(-1)).toEqual({ role: 'user', content: 'm24' });
  });

  it('always starts with a user message', () => {
    const messages = [
      { role: 'assistant' as const, content: 'stray' },
      { role: 'user' as const, content: 'hi' },
    ];
    expect(selectRecentTurns(messages)[0]?.role).toBe('user');
  });
});
