import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getToken = vi.fn();
vi.mock('../../../components/concierge/turnstile', () => ({ getToken: () => getToken() }));

import { fetchReport, scanSite, unlockReport } from '../api';
import { SCAN_TIMEOUT_MS } from '../config';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('checker api', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('VITE_CONCIERGE_API_URL', 'https://worker.test/');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    getToken.mockReset();
    getToken.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('posts the scan body with the profile, an empty honeypot and no token when Turnstile is off', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: false, host: 'a.com', reason: 'blocked' }));
    await scanSite({ url: 'a.com', profile: 'health' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://worker.test/checker/scan');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ url: 'a.com', profile: 'health', company_website: '' });
  });

  it('sends a fresh Turnstile token on every request and force on a re-check', async () => {
    getToken.mockResolvedValueOnce('t1').mockResolvedValueOnce('t2');
    fetchMock.mockResolvedValue(json(200, { ok: false, host: 'a.com', reason: 'blocked' }));
    await scanSite({ url: 'a.com', profile: 'trade' });
    await scanSite({ url: 'a.com', profile: 'trade', force: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).turnstileToken).toBe('t1');
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.turnstileToken).toBe('t2');
    expect(second.force).toBe(true);
  });

  it('gives up after 35 seconds with a timeout outcome', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_u: string, init: RequestInit) =>
        new Promise((_r, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );
    const p = scanSite({ url: 'slow.com', profile: 'trade' });
    await vi.advanceTimersByTimeAsync(SCAN_TIMEOUT_MS - 1);
    let settled = false;
    void p.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toEqual({ kind: 'timeout' });
    expect(SCAN_TIMEOUT_MS).toBe(35000);
  });

  it('maps limits and the launch gate', async () => {
    fetchMock.mockResolvedValueOnce(json(429, { error: 'rate_limited' }));
    expect(await scanSite({ url: 'a.com', profile: 'trade' })).toEqual({ kind: 'rate_limited' });
    fetchMock.mockResolvedValueOnce(json(429, { error: 'daily_cap' }));
    expect(await scanSite({ url: 'a.com', profile: 'trade' })).toEqual({ kind: 'daily_cap' });
    fetchMock.mockResolvedValueOnce(json(503, { error: 'checker_not_ready' }));
    expect(await scanSite({ url: 'a.com', profile: 'trade' })).toEqual({ kind: 'not_ready' });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await scanSite({ url: 'a.com', profile: 'trade' })).toEqual({ kind: 'network' });
  });

  it('treats an unknown reason or a malformed success as a network problem, never a crash', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: false, host: 'a.com', reason: 'something_new' }));
    expect(await scanSite({ url: 'a.com', profile: 'trade' })).toEqual({ kind: 'network' });
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    expect(await scanSite({ url: 'a.com', profile: 'trade' })).toEqual({ kind: 'network' });
  });

  it('unlock sends only what it was given, plus the honeypot', async () => {
    fetchMock.mockResolvedValue(json(404, {}));
    await unlockReport({ scanId: 's1', industry: 'trade' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      scanId: 's1',
      industry: 'trade',
      company_website: '',
    });
  });

  it('unlock returns the server\'s field errors from a 400', async () => {
    fetchMock.mockResolvedValue(json(400, { ok: false, fields: { phone: 'Bad phone' } }));
    expect(await unlockReport({ scanId: 's1', industry: 'trade', name: 'A', email: 'a@b.co', phone: '1' })).toEqual({
      kind: 'fields',
      fields: { phone: 'Bad phone' },
    });
  });

  it('unlock folds a top-level plan into the report', async () => {
    const plan = { summary: 'S', items: [] };
    fetchMock.mockResolvedValue(
      json(200, { ok: true, report_token: 'tok', report: { host: 'a.com' }, plan, emailed: true })
    );
    const out = await unlockReport({ scanId: 's1', industry: 'trade' });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.report.plan).toEqual(plan);
      expect(out.emailed).toBe(true);
    }
  });

  it('fetches a report by token with GET and no referrer, and maps 404', async () => {
    fetchMock.mockResolvedValue(json(404, { ok: false, reason: 'not_found' }));
    expect(await fetchReport('abc def')).toEqual({ kind: 'not_found' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://worker.test/checker/report?r=abc%20def');
    expect(init.method).toBe('GET');
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  it('answers not_ready without a request when no Worker URL is configured', async () => {
    vi.stubEnv('VITE_CONCIERGE_API_URL', '');
    expect(await scanSite({ url: 'a.com', profile: 'trade' })).toEqual({ kind: 'not_ready' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
