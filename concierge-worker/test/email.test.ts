import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLeadEmail, formatPhone, sendViaResend } from '../src/email';
import type { LeadPayload } from '../src/validation';
import { testEnv } from './helpers';

const NOW = new Date('2026-11-03T21:05:30.000Z'); // 4:05 PM EST on Nov 3, 2026

// Independent of the implementation: how a US English reader sees the same instant in New York.
// Newer ICU versions put a narrow no-break space before "PM"; the email normalizes it to a space.
const expectedStamp = `${new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  dateStyle: 'medium',
  timeStyle: 'short',
})
  .format(NOW)
  .replace(new RegExp(`[${String.fromCharCode(0x202f, 0xa0)}]`, 'g'), ' ')} ET`;

const lead = (overrides: Partial<LeadPayload> = {}): LeadPayload => ({
  sessionId: '3f2b8c1e-5d4a-4e7b-9a10-0c1d2e3f4a5b',
  name: 'Jane Doe',
  phone: '7705551234',
  email: 'jane@example.com',
  business: 'Doe Plumbing',
  need: 'Missed calls after hours',
  callbackWindow: 'morning_9_11',
  consent: true,
  transcript: [
    { role: 'user', content: 'What do you do?', at: '2026-11-03T21:00:10.000Z' },
    { role: 'assistant', content: 'We help local businesses save time with AI.', at: '2026-11-03T21:00:14.000Z' },
    { role: 'user', content: 'Yes, call me', at: '2026-11-03T21:04:50.000Z' },
  ],
  page: { url: 'https://thgservices.io/#ai-concierge', utm: { utm_source: 'google', utm_medium: 'cpc' } },
  ...overrides,
});

describe('formatPhone', () => {
  it('formats ten digits as (NNN) NNN-NNNN', () => {
    expect(formatPhone('7705551234')).toBe('(770) 555-1234');
  });
  it('leaves anything else alone', () => {
    expect(formatPhone('12345')).toBe('12345');
  });
});

describe('buildLeadEmail', () => {
  it('builds the subject from the business and the name', () => {
    expect(buildLeadEmail(lead(), NOW).subject).toBe('New website lead: Doe Plumbing — Jane Doe');
  });

  it('includes every field in the plain-text body', () => {
    const { text } = buildLeadEmail(lead(), NOW);
    expect(text).toContain('Jane Doe');
    expect(text).toContain('(770) 555-1234');
    expect(text).toContain('jane@example.com');
    expect(text).toContain('Doe Plumbing');
    expect(text).toContain('Missed calls after hours');
    expect(text).toContain('Weekday morning (9–11 AM ET)');
    expect(text).toContain('https://thgservices.io/#ai-concierge');
    expect(text).toContain('utm_source: google');
    expect(text).toContain('utm_medium: cpc');
    expect(text).toContain(expectedStamp);
    expect(text).toMatch(/consent/i);
  });

  it('formats the submission time in Eastern time with an ET suffix', () => {
    expect(expectedStamp).toMatch(/^Nov 3, 2026, 4:05\sPM ET$/);
    const { text } = buildLeadEmail(lead(), NOW);
    expect(text).toContain('Nov 3, 2026, 4:05 PM ET');
    expect(text).not.toContain(String.fromCharCode(0x202f)); // no narrow no-break space left over
  });

  it('writes the transcript as "[time] You: ..." and "[time] THG helper: ..." lines in order', () => {
    const lines = buildLeadEmail(lead(), NOW).text.split('\n');
    const start = lines.findIndex((line) => line.includes('What do you do?'));
    expect(lines[start]).toBe('[4:00 PM] You: What do you do?');
    expect(lines[start + 1]).toBe('[4:00 PM] THG helper: We help local businesses save time with AI.');
    expect(lines[start + 2]).toBe('[4:04 PM] You: Yes, call me');
  });

  it('uses a placeholder time for an unparseable timestamp and a note for an empty transcript', () => {
    const odd = buildLeadEmail(lead({ transcript: [{ role: 'user', content: 'hi', at: '' }] }), NOW).text;
    expect(odd).toContain('[--:--] You: hi');
    const none = buildLeadEmail(lead({ transcript: [] }), NOW).text;
    expect(none).toMatch(/no chat/i);
  });

  it('copes with a lead that gave no email, no need and no UTM data', () => {
    const { text, html } = buildLeadEmail(lead({ email: undefined, need: '', page: { url: '', utm: {} } }), NOW);
    expect(text).toMatch(/Email:\s+\(not provided\)/);
    expect(text).toMatch(/Need:\s+\(not provided\)/);
    expect(text).toMatch(/UTM:\s+\(none\)/);
    expect(html).toContain('not provided');
  });

  it('keeps the subject on one line even if the name or business contain line breaks', () => {
    const { subject } = buildLeadEmail(lead({ name: 'Jane\r\nBcc: evil@example.com', business: 'Doe\nPlumbing' }), NOW);
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toBe('New website lead: Doe Plumbing — Jane Bcc: evil@example.com');
  });

  it('clamps a long subject at 200 characters without splitting an emoji', () => {
    const emoji = String.fromCodePoint(0x1f600); // two UTF-16 units
    // "New website lead: " is 18 characters; the emoji would straddle characters 200 and 201.
    const business = 'x'.repeat(181) + emoji;
    const { subject } = buildLeadEmail(lead({ business }), NOW);
    expect(subject.length).toBeLessThanOrEqual(200);
    const last = subject.charCodeAt(subject.length - 1);
    expect(last < 0xd800 || last > 0xdbff).toBe(true); // not left holding half of a surrogate pair
  });

  it('HTML-escapes everything in the html body', () => {
    const { html } = buildLeadEmail(
      lead({
        name: '<img src=x onerror=alert(1)>',
        business: 'A&B "Plumbing" <script>x</script>',
        need: "it's <b>bold</b>",
        transcript: [{ role: 'user', content: '<script>alert(1)</script>', at: '' }],
        page: { url: 'https://thgservices.io/?q="><script>', utm: { utm_source: '<x>' } },
      }),
      NOW,
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>bold');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('A&amp;B &quot;Plumbing&quot;');
    expect(html).toContain('it&#39;s');
  });

  it('links the page URL only when it is on thgservices.io or www.thgservices.io over https', () => {
    for (const url of ['https://thgservices.io/#ai-concierge', 'https://www.thgservices.io/?utm_source=google', 'https://thgservices.io']) {
      const html = buildLeadEmail(lead({ page: { url, utm: {} } }), NOW).html;
      expect(html, url).toContain(`href="${url}"`);
    }
  });

  it.each([
    'http://thgservices.io/',
    'https://evil.example/thgservices.io',
    'https://thgservices.io.evil.example/',
    'https://thgservices.io@evil.example/',
    'https://evil.example/?next=https://thgservices.io',
    'https://thgservices.io:8443/',
    'https://sub.thgservices.io/',
    'http://localhost:3000/',
    'javascript:alert(1)',
    'data:text/html,hello',
    'not a url at all',
  ])('shows %s as plain text, never as a link', (url) => {
    const html = buildLeadEmail(lead({ page: { url, utm: {} } }), NOW).html;
    expect(html).not.toContain('href="' + url);
    expect(html).not.toMatch(/<a href="(?!mailto:)/);
    expect(html).toContain(url.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
  });

  it('exposes the address to reply to (the lead, when given)', () => {
    expect(buildLeadEmail(lead(), NOW).replyTo).toBe('jane@example.com');
    expect(buildLeadEmail(lead({ email: undefined }), NOW).replyTo).toBeUndefined();
  });
});

describe('sendViaResend', () => {
  afterEach(() => vi.restoreAllMocks());

  const env = () => testEnv({ RESEND_API_KEY: 'placeholder-not-a-real-key' });
  const message = () => buildLeadEmail(lead(), NOW);
  const reply = (status: number) => new Response(JSON.stringify({ id: 'x' }), { status });

  it('posts the documented Resend payload with the API key and an idempotency key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(200));
    expect(await sendViaResend(env(), message(), { retryDelayMs: 0 })).toBe(true);

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer placeholder-not-a-real-key');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      from: 'THG AI Services <concierge@leadquik.com>',
      to: ['developer@leadquik.com'],
      subject: 'New website lead: Doe Plumbing — Jane Doe',
      text: message().text,
      html: message().html,
      reply_to: 'jane@example.com',
    });
  });

  it('omits reply_to when the lead gave no email', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(200));
    await sendViaResend(env(), buildLeadEmail(lead({ email: undefined }), NOW), { retryDelayMs: 0 });
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body))).not.toHaveProperty('reply_to');
  });

  it('retries once on a 5xx and reuses the same idempotency key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply(500)).mockResolvedValueOnce(reply(200));
    expect(await sendViaResend(env(), message(), { retryDelayMs: 0 })).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const keys = fetchSpy.mock.calls.map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
  });

  it.each([429, 503])('retries once on a %i', async (status) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply(status)).mockResolvedValueOnce(reply(200));
    expect(await sendViaResend(env(), message(), { retryDelayMs: 0 })).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries once on a network error', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('down')).mockResolvedValueOnce(reply(200));
    expect(await sendViaResend(env(), message(), { retryDelayMs: 0 })).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry fails too', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(500));
    expect(await sendViaResend(env(), message(), { retryDelayMs: 0 })).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 422])('does not retry a %i (a retry cannot fix it)', async (status) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(status));
    expect(await sendViaResend(env(), message(), { retryDelayMs: 0 })).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not call Resend at all without an API key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await sendViaResend(testEnv({ RESEND_API_KEY: undefined }), message(), { retryDelayMs: 0 })).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('trims whitespace around the API key before sending it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(200));
    await sendViaResend(testEnv({ RESEND_API_KEY: '  placeholder-not-a-real-key\n' }), message(), { retryDelayMs: 0 });
    expect(new Headers(fetchSpy.mock.calls[0]![1]?.headers).get('Authorization')).toBe('Bearer placeholder-not-a-real-key');
  });

  it('treats a whitespace-only API key as no key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await sendViaResend(testEnv({ RESEND_API_KEY: ' \n' }), message(), { retryDelayMs: 0 })).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('times out a hanging request per attempt, retries once, then gives up', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const started = Date.now();
    expect(await sendViaResend(env(), message(), { retryDelayMs: 0, timeoutMs: 50 })).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('never logs the API key or the lead details', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'warn').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(500));
    await sendViaResend(env(), message(), { retryDelayMs: 0 });
    const text = lines.join('\n');
    expect(text).not.toContain('placeholder-not-a-real-key');
    expect(text).not.toContain('Jane');
    expect(text).not.toContain('7705551234');
  });
});
