import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_TIMEOUT_MS, LEAD_TIMEOUT_MS, postChat, postLead } from '../api';
import type { ChatRequest, LeadRequest } from '../types';

const chatReq: ChatRequest = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  messages: [{ role: 'user', content: 'What do you do?' }],
};

const leadReq: LeadRequest = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  name: 'Jane Doe',
  phone: '7705551234',
  business: 'Doe Plumbing',
  callbackWindow: 'morning_9_11',
  consent: true,
  transcript: [],
  page: { url: 'https://thgservices.io/', utm: {} },
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('api', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('VITE_CONCIERGE_API_URL', 'http://localhost:8787/');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('postChat', () => {
    it('POSTs JSON to {base}/chat without a doubled slash', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { reply: 'Hi', intent: 'answer', offerCallback: false })
      );
      await postChat({ ...chatReq, turnstileToken: 'tok' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:8787/chat');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json'
      );
      expect(init.credentials).toBe('omit');
      expect(JSON.parse(init.body as string)).toEqual({
        ...chatReq,
        turnstileToken: 'tok',
      });
    });

    it('200 returns the typed reply', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { reply: 'We help.', intent: 'handoff', offerCallback: true })
      );
      expect(await postChat(chatReq)).toEqual({
        kind: 'ok',
        data: { reply: 'We help.', intent: 'handoff', offerCallback: true },
      });
    });

    it('200 with an unknown intent is treated as a plain answer', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { reply: 'Hello', intent: 'weird', offerCallback: 'yes' })
      );
      expect(await postChat(chatReq)).toEqual({
        kind: 'ok',
        data: { reply: 'Hello', intent: 'answer', offerCallback: false },
      });
    });

    it('200 without a reply string is an error', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { intent: 'answer' }));
      expect(await postChat(chatReq)).toEqual({ kind: 'error', reason: 'server' });
    });

    it('429 is rate_limited and carries the reply', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(429, { error: 'rate_limited', reply: 'Call us' })
      );
      expect(await postChat(chatReq)).toEqual({ kind: 'rate_limited', reply: 'Call us' });
    });

    it('403 verification_required', async () => {
      fetchMock.mockResolvedValue(jsonResponse(403, { error: 'verification_required' }));
      expect(await postChat(chatReq)).toEqual({ kind: 'verification_required' });
    });

    it('403 ended carries the reply', async () => {
      fetchMock.mockResolvedValue(jsonResponse(403, { error: 'ended', reply: 'Bye' }));
      expect(await postChat(chatReq)).toEqual({ kind: 'ended', reply: 'Bye' });
    });

    it('403 for any other reason (for example a disallowed origin) is an error', async () => {
      fetchMock.mockResolvedValue(jsonResponse(403, { error: 'origin_not_allowed' }));
      expect(await postChat(chatReq)).toEqual({ kind: 'error', reason: 'server' });
    });

    it('503 capacity switches to lead_only', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(503, { error: 'capacity', mode: 'lead_only', reply: 'Break' })
      );
      expect(await postChat(chatReq)).toEqual({ kind: 'lead_only', reply: 'Break' });
    });

    it('400 message_too_long and 400 bad_request are distinguished', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(400, { error: 'message_too_long', reply: 'Too long' })
      );
      expect(await postChat(chatReq)).toEqual({ kind: 'too_long', reply: 'Too long' });
      fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'bad_request' }));
      expect(await postChat(chatReq)).toEqual({ kind: 'error', reason: 'bad_request' });
    });

    it('a network failure is a typed error, not a throw', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      expect(await postChat(chatReq)).toEqual({ kind: 'error', reason: 'network' });
    });

    it('a non-JSON body is an error', async () => {
      fetchMock.mockResolvedValue(new Response('<html>nope</html>', { status: 500 }));
      expect(await postChat(chatReq)).toEqual({ kind: 'error', reason: 'server' });
    });

    it('aborts the request after the timeout and reports a timeout error', async () => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            signal = init.signal as AbortSignal;
            signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      );
      const pending = postChat(chatReq);
      expect(CHAT_TIMEOUT_MS).toBe(15000);
      await vi.advanceTimersByTimeAsync(CHAT_TIMEOUT_MS - 1);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(signal?.aborted).toBe(true);
      expect(await pending).toEqual({ kind: 'error', reason: 'timeout' });
    });
  });

  describe('postLead', () => {
    it('POSTs to {base}/lead and returns the delivery on 200', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, delivery: 'email' }));
      const res = await postLead(leadReq);
      expect(res).toEqual({ kind: 'ok', delivery: 'email' });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:8787/lead');
      expect(JSON.parse(init.body as string)).toEqual(leadReq);
    });

    it('accepts every documented delivery value', async () => {
      for (const delivery of ['email', 'email+leadquik', 'leadquik']) {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, delivery }));
        expect(await postLead(leadReq)).toEqual({ kind: 'ok', delivery });
      }
    });

    it('400 validation returns only string field messages', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(400, {
          ok: false,
          error: 'validation',
          fields: { phone: 'Enter a 10-digit US phone number', junk: 5 },
        })
      );
      expect(await postLead(leadReq)).toEqual({
        kind: 'validation',
        fields: { phone: 'Enter a 10-digit US phone number' },
      });
    });

    it('403 verification_failed, 429 rate_limited and 502 delivery_failed are typed', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(403, { ok: false, error: 'verification_failed' })
      );
      expect(await postLead(leadReq)).toEqual({ kind: 'verification_failed' });
      fetchMock.mockResolvedValueOnce(jsonResponse(429, { ok: false, error: 'rate_limited' }));
      expect(await postLead(leadReq)).toEqual({ kind: 'rate_limited' });
      fetchMock.mockResolvedValueOnce(
        jsonResponse(502, { ok: false, error: 'delivery_failed' })
      );
      expect(await postLead(leadReq)).toEqual({ kind: 'delivery_failed' });
    });

    it('a network failure is a typed error', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      expect(await postLead(leadReq)).toEqual({ kind: 'error', reason: 'network' });
    });

    it('waits 30 seconds (twice the chat limit), then aborts and reports a timeout', async () => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            signal = init.signal as AbortSignal;
            signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      );
      const pending = postLead(leadReq);
      expect(LEAD_TIMEOUT_MS).toBe(30000);
      // Past the chat limit and still waiting.
      await vi.advanceTimersByTimeAsync(CHAT_TIMEOUT_MS + 1000);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(LEAD_TIMEOUT_MS - CHAT_TIMEOUT_MS);
      expect(signal?.aborted).toBe(true);
      expect(await pending).toEqual({ kind: 'error', reason: 'timeout' });
    });

    it('keeps field errors for names the form does not render, so the caller can show them', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(400, { ok: false, error: 'validation', fields: { transcript: 'Too many entries' } })
      );
      expect(await postLead(leadReq)).toEqual({
        kind: 'validation',
        fields: { transcript: 'Too many entries' },
      });
    });
  });
});
