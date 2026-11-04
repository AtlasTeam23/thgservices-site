import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLeadQuikPayload, sendToLeadQuik } from '../src/leadquik';
import type { LeadPayload } from '../src/validation';

const NOW = new Date('2026-11-03T21:05:30.000Z');
const URL_OK = 'https://hooks.leadquik.example/concierge?token=placeholder-not-a-real-token';

const lead = (overrides: Partial<LeadPayload> = {}): LeadPayload => ({
  sessionId: '3f2b8c1e-5d4a-4e7b-9a10-0c1d2e3f4a5b',
  name: 'Jane Doe',
  phone: '7705551234',
  email: 'jane@example.com',
  business: 'Doe Plumbing',
  need: 'Missed calls',
  callbackWindow: 'midday_11_1',
  consent: true,
  transcript: [{ role: 'user', content: 'hi', at: '2026-11-03T21:00:10.000Z' }],
  page: { url: 'https://thgservices.io/', utm: { utm_source: 'google' } },
  ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe('buildLeadQuikPayload', () => {
  it('has exactly the documented fields', () => {
    const payload = buildLeadQuikPayload(lead(), NOW);
    expect(Object.keys(payload).sort()).toEqual(
      ['business', 'callbackWindow', 'consent', 'createdAt', 'email', 'name', 'need', 'phone', 'source', 'transcript'].sort(),
    );
    expect(payload).toMatchObject({ source: 'thgservices.io concierge', createdAt: '2026-11-03T21:05:30.000Z', consent: true });
  });

  it('sends an empty string, not undefined, when the visitor gave no email', () => {
    expect(buildLeadQuikPayload(lead({ email: undefined }), NOW).email).toBe('');
  });
});

describe('sendToLeadQuik', () => {
  it.each([undefined, ''])('is a no-op without a URL (%j)', async (url) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await sendToLeadQuik(lead(), url, NOW)).toBe('skipped');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts JSON and reports ok on a 2xx', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await sendToLeadQuik(lead(), URL_OK, NOW)).toBe('ok');
    const [target, init] = fetchSpy.mock.calls[0]!;
    expect(String(target)).toBe(URL_OK);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toMatchObject({ name: 'Jane Doe', source: 'thgservices.io concierge' });
  });

  it.each([400, 401, 500, 503])('reports failed on a %i, without retrying', async (status) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status }));
    expect(await sendToLeadQuik(lead(), URL_OK, NOW)).toBe('failed');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('reports failed on a network error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('down'));
    expect(await sendToLeadQuik(lead(), URL_OK, NOW)).toBe('failed');
  });

  it('times out a hanging request and reports failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const started = Date.now();
    expect(await sendToLeadQuik(lead(), URL_OK, NOW, 50)).toBe('failed');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it.each(['http://hooks.leadquik.example/x', 'ftp://hooks.leadquik.example/x', 'javascript:alert(1)', 'not a url'])(
    'refuses %j without calling anything',
    async (url) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      expect(await sendToLeadQuik(lead(), url, NOW)).toBe('failed');
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each(['http://localhost:9000/hook', 'http://127.0.0.1:9000/hook'])('allows plain http for local development (%s)', async (url) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await sendToLeadQuik(lead(), url, NOW)).toBe('ok');
  });

  it('never logs the URL (it is the credential) or lead details', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'warn').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 500 }));
    await sendToLeadQuik(lead(), URL_OK, NOW);
    await sendToLeadQuik(lead(), 'http://insecure.example/secret-path', NOW);
    const text = lines.join('\n');
    expect(text).not.toContain('placeholder-not-a-real-token');
    expect(text).not.toContain('secret-path');
    expect(text).not.toContain('Jane');
    expect(text).not.toContain('7705551234');
  });
});
