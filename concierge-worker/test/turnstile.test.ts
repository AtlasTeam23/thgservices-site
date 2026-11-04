import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURNSTILE_VERIFY_URL, resetTurnstileWarning, verifyTurnstile } from '../src/turnstile';

// Cloudflare's published Turnstile TEST secret keys. Not secrets: they exist so tests can
// run without a real widget. https://developers.cloudflare.com/turnstile/troubleshooting/testing/
const TEST_SECRET_ALWAYS_PASSES = '1x0000000000000000000000000000000AA';
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const siteverify = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => resetTurnstileWarning());
afterEach(() => vi.restoreAllMocks());

describe('verifyTurnstile without a secret', () => {
  it('passes without calling Cloudflare, and warns only once per isolate', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await verifyTurnstile(undefined, '203.0.113.9', undefined)).toBe(true);
    expect(await verifyTurnstile('anything', '203.0.113.9', '')).toBe(true);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('TURNSTILE_SECRET_KEY');
  });
});

describe('verifyTurnstile with a secret', () => {
  it('posts form-encoded secret, response and remoteip to siteverify and accepts success: true', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(siteverify({ success: true, hostname: 'thgservices.io' }));

    expect(await verifyTurnstile(DUMMY_TOKEN, '203.0.113.9', TEST_SECRET_ALWAYS_PASSES)).toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(TURNSTILE_VERIFY_URL).toBe(String(url));
    expect(init?.method).toBe('POST');
    const body = init?.body as URLSearchParams;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body.get('secret')).toBe(TEST_SECRET_ALWAYS_PASSES);
    expect(body.get('response')).toBe(DUMMY_TOKEN);
    expect(body.get('remoteip')).toBe('203.0.113.9');
    // A URLSearchParams body makes fetch send application/x-www-form-urlencoded.
    expect(new Request('https://x.test', { method: 'POST', body }).headers.get('content-type')).toContain(
      'application/x-www-form-urlencoded',
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('leaves remoteip out when the client address is unknown', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(siteverify({ success: true }));
    await verifyTurnstile(DUMMY_TOKEN, null, TEST_SECRET_ALWAYS_PASSES);
    expect((fetchSpy.mock.calls[0]![1]!.body as URLSearchParams).has('remoteip')).toBe(false);
  });

  it('rejects when Cloudflare says success is false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(siteverify({ success: false, 'error-codes': ['invalid-input-response'] }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await verifyTurnstile('bad', '203.0.113.9', TEST_SECRET_ALWAYS_PASSES)).toBe(false);
  });

  it.each([{}, { success: 'true' }, { success: 1 }, { success: null }, []])('only accepts success === true (%j)', async (body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(siteverify(body));
    expect(await verifyTurnstile(DUMMY_TOKEN, null, TEST_SECRET_ALWAYS_PASSES)).toBe(false);
  });

  it('rejects a missing or oversized token without calling Cloudflare', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await verifyTurnstile(undefined, null, TEST_SECRET_ALWAYS_PASSES)).toBe(false);
    expect(await verifyTurnstile('', null, TEST_SECRET_ALWAYS_PASSES)).toBe(false);
    expect(await verifyTurnstile('x'.repeat(2049), null, TEST_SECRET_ALWAYS_PASSES)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails closed on a non-2xx response, a network error, or a non-JSON body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(siteverify({ success: true }, 500));
    expect(await verifyTurnstile(DUMMY_TOKEN, null, TEST_SECRET_ALWAYS_PASSES)).toBe(false);
    fetchSpy.mockRejectedValueOnce(new TypeError('network down'));
    expect(await verifyTurnstile(DUMMY_TOKEN, null, TEST_SECRET_ALWAYS_PASSES)).toBe(false);
    fetchSpy.mockResolvedValueOnce(new Response('<html>oops</html>', { status: 200 }));
    expect(await verifyTurnstile(DUMMY_TOKEN, null, TEST_SECRET_ALWAYS_PASSES)).toBe(false);
  });

  it('times out and fails closed when siteverify hangs', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const started = Date.now();
    expect(await verifyTurnstile(DUMMY_TOKEN, null, TEST_SECRET_ALWAYS_PASSES, 50)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('never logs the secret or the token', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'warn').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(siteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] }));

    await verifyTurnstile(DUMMY_TOKEN, '203.0.113.9', TEST_SECRET_ALWAYS_PASSES);

    const text = lines.join('\n');
    expect(text).not.toContain(TEST_SECRET_ALWAYS_PASSES);
    expect(text).not.toContain(DUMMY_TOKEN);
    expect(text).toContain('timeout-or-duplicate'); // public error codes are fine and useful
  });
});
