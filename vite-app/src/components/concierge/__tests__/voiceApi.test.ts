import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchTts,
  fetchVoiceCaps,
  HEALTH_TIMEOUT_MS,
  postStt,
  STT_TIMEOUT_MS,
  TTS_TIMEOUT_MS,
} from '../api';

const SESSION = '11111111-1111-4111-8111-111111111111';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const clip = (type = 'audio/webm;codecs=opus') => new Blob([new Uint8Array([1, 2, 3, 4])], { type });

describe('voice api', () => {
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

  describe('timeouts', () => {
    it('allow the upload plus the Worker\'s 8 s model attempts for speech to text, and 8 s for the premium voice', () => {
      expect(STT_TIMEOUT_MS).toBe(20_000);
      expect(TTS_TIMEOUT_MS).toBe(8_000);
      expect(HEALTH_TIMEOUT_MS).toBe(5_000);
    });
  });

  describe('postStt', () => {
    it('POSTs multipart form data to {base}/stt with the audio, session and duration', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { text: 'what do you do', durationMs: 2500 }));
      await postStt(clip(), 'audio/webm;codecs=opus', SESSION, 'tok', 2500);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:8787/stt');
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('omit');
      // The browser must set the multipart boundary itself.
      expect(init.headers).toBeUndefined();

      const form = init.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      const audio = form.get('audio') as File;
      expect(audio).toBeInstanceOf(Blob);
      expect(audio.size).toBe(4);
      expect(form.get('sessionId')).toBe(SESSION);
      expect(form.get('turnstileToken')).toBe('tok');
      expect(form.get('durationMs')).toBe('2500');
    });

    it('sends the bare MIME type (no codecs parameter) and a matching file name', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { text: 'hi' }));
      await postStt(clip('audio/webm;codecs=opus'), 'audio/webm;codecs=opus', SESSION);
      let audio = (fetchMock.mock.calls[0][1].body as FormData).get('audio') as File;
      expect(audio.type).toBe('audio/webm');
      expect(audio.name).toBe('speech.webm');

      fetchMock.mockClear();
      await postStt(clip('audio/mp4'), 'audio/mp4', SESSION);
      audio = (fetchMock.mock.calls[0][1].body as FormData).get('audio') as File;
      expect(audio.type).toBe('audio/mp4');
      expect(audio.name).toBe('speech.m4a');

      fetchMock.mockClear();
      await postStt(clip('audio/ogg;codecs=opus'), 'audio/ogg;codecs=opus', SESSION);
      audio = (fetchMock.mock.calls[0][1].body as FormData).get('audio') as File;
      expect(audio.type).toBe('audio/ogg');
      expect(audio.name).toBe('speech.ogg');
    });

    it('leaves out the token and duration when not given, and caps the duration at 20 seconds', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { text: 'hi' }));
      await postStt(clip(), 'audio/webm', SESSION);
      let form = fetchMock.mock.calls[0][1].body as FormData;
      expect(form.has('turnstileToken')).toBe(false);
      expect(form.has('durationMs')).toBe(false);

      fetchMock.mockClear();
      await postStt(clip(), 'audio/webm', SESSION, null, 31234.6);
      form = fetchMock.mock.calls[0][1].body as FormData;
      expect(form.get('durationMs')).toBe('20000');
    });

    it('200 returns the transcript and the server-measured duration', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { text: 'what do you do', durationMs: 2500 }));
      expect(await postStt(clip(), 'audio/webm', SESSION)).toEqual({
        kind: 'ok',
        text: 'what do you do',
        durationMs: 2500,
      });
    });

    it('200 with an empty transcript is ok with empty text; a missing duration is null', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { text: '' }));
      expect(await postStt(clip(), 'audio/webm', SESSION)).toEqual({
        kind: 'ok',
        text: '',
        durationMs: null,
      });
    });

    it('200 without a string transcript is a server error', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { nope: true }));
      expect(await postStt(clip(), 'audio/webm', SESSION)).toEqual({
        kind: 'error',
        reason: 'server',
      });
    });

    it('maps the documented error statuses', async () => {
      const cases: Array<[number, unknown, unknown]> = [
        [400, { error: 'bad_audio' }, { kind: 'bad_audio' }],
        [400, { error: 'something_else' }, { kind: 'error', reason: 'server' }],
        [403, { error: 'verification_required' }, { kind: 'verification_required' }],
        [403, { error: 'other' }, { kind: 'error', reason: 'server' }],
        [429, { error: 'rate_limited' }, { kind: 'rate_limited' }],
        [503, { error: 'voice_unavailable', reason: 'budget' }, { kind: 'voice_unavailable', reason: 'budget' }],
        [503, { error: 'voice_unavailable', reason: 'server' }, { kind: 'voice_unavailable', reason: 'server' }],
        // No reason, or one we do not know: the safe reading is "the service is having trouble".
        [503, { error: 'voice_unavailable' }, { kind: 'voice_unavailable', reason: 'server' }],
        [503, { error: 'voice_unavailable', reason: 'weather' }, { kind: 'voice_unavailable', reason: 'server' }],
        // A Worker that predates voice has no /stt route at all.
        [404, { error: 'not_found' }, { kind: 'voice_unavailable', reason: 'server' }],
        [500, { error: 'boom' }, { kind: 'error', reason: 'server' }],
      ];
      for (const [status, body, expected] of cases) {
        fetchMock.mockResolvedValueOnce(jsonResponse(status, body));
        expect(await postStt(clip(), 'audio/webm', SESSION), `${status}`).toEqual(expected);
      }
    });

    it('a non-JSON error body still maps by status', async () => {
      fetchMock.mockResolvedValue(new Response('<html>', { status: 503 }));
      expect(await postStt(clip(), 'audio/webm', SESSION)).toEqual({
        kind: 'voice_unavailable',
        reason: 'server',
      });
    });

    it('a network failure is a network error', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      expect(await postStt(clip(), 'audio/webm', SESSION)).toEqual({
        kind: 'error',
        reason: 'network',
      });
    });

    it('aborts and reports a timeout when the Worker is too slow', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      );
      const pending = postStt(clip(), 'audio/webm', SESSION);
      await vi.advanceTimersByTimeAsync(STT_TIMEOUT_MS + 1);
      expect(await pending).toEqual({ kind: 'error', reason: 'timeout' });
    });
  });

  describe('fetchTts', () => {
    it('POSTs {sessionId, text} as JSON to {base}/tts and returns the audio', async () => {
      fetchMock.mockResolvedValue(
        new Response(new Uint8Array([9, 9, 9]), {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        })
      );
      const res = await fetchTts('Hello there.', SESSION);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:8787/tts');
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('omit');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual({ sessionId: SESSION, text: 'Hello there.' });

      expect(res.kind).toBe('ok');
      if (res.kind === 'ok') {
        expect(res.blob.size).toBe(3);
        expect(res.blob.type).toBe('audio/mpeg');
      }
    });

    it('429 tts_limit is the daily spoken-reply cap, and says whether a bonus is on offer', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'tts_limit', bonusAvailable: true }));
      expect(await fetchTts('Hi', SESSION)).toEqual({ kind: 'limit', bonusAvailable: true });
      // The Worker may say how many replies the bonus adds.
      fetchMock.mockResolvedValueOnce(
        jsonResponse(429, { error: 'tts_limit', bonusAvailable: true, bonus: 10 })
      );
      expect(await fetchTts('Hi', SESSION)).toEqual({ kind: 'limit', bonusAvailable: true, bonus: 10 });
      // Only a sane whole number counts; anything else is left out and the default 5 is used.
      for (const bonus of [0, -3, 2.5, 1000, '10', null, Number.NaN]) {
        fetchMock.mockResolvedValueOnce(
          jsonResponse(429, { error: 'tts_limit', bonusAvailable: true, bonus })
        );
        expect(await fetchTts('Hi', SESSION), String(bonus)).toEqual({
          kind: 'limit',
          bonusAvailable: true,
        });
      }
      fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'tts_limit', bonusAvailable: false }));
      expect(await fetchTts('Hi', SESSION)).toEqual({ kind: 'limit', bonusAvailable: false });
      // Anything that is not exactly `true` is no bonus.
      fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'tts_limit' }));
      expect(await fetchTts('Hi', SESSION)).toEqual({ kind: 'limit', bonusAvailable: false });
      fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'tts_limit', bonusAvailable: 'yes' }));
      expect(await fetchTts('Hi', SESSION)).toEqual({ kind: 'limit', bonusAvailable: false });
    });

    it('any other 429 (an ordinary rate limit) is just "unavailable"', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'rate_limited' }));
      expect(await fetchTts('Hi', SESSION)).toEqual({ kind: 'unavailable' });
    });

    it('every other way of not getting audio is simply "unavailable"', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: 'voice_unavailable' }));
      expect(await fetchTts('Hi', SESSION)).toEqual({ kind: 'unavailable' });
      fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'not_found' }));
      expect(await fetchTts('Hi', SESSION)).toEqual({ kind: 'unavailable' });
      fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'x' }));
      expect(await fetchTts('Hi', SESSION)).toEqual({ kind: 'unavailable' });
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(), { status: 200 }));
      expect(await fetchTts('Hi', SESSION)).toEqual({ kind: 'unavailable' });
      fetchMock.mockRejectedValueOnce(new TypeError('offline'));
      expect(await fetchTts('Hi', SESSION)).toEqual({ kind: 'unavailable' });
    });

    it('aborting the signal cancels the request at once, and is just "unavailable"', async () => {
      let seen: AbortSignal | undefined;
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            seen = init.signal ?? undefined;
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      );
      const controller = new AbortController();
      const pending = fetchTts('Hi', SESSION, controller.signal);
      expect(seen?.aborted).toBe(false);
      controller.abort();
      expect(seen?.aborted).toBe(true);
      expect(await pending).toEqual({ kind: 'unavailable' });
    });

    it('a signal that is already aborted never reaches the network', async () => {
      const controller = new AbortController();
      controller.abort();
      expect(await fetchTts('Hi', SESSION, controller.signal)).toEqual({ kind: 'unavailable' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('without a signal, or with one that is never aborted, nothing changes', async () => {
      fetchMock.mockImplementation(
        async () =>
          new Response(new Uint8Array([9]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })
      );
      expect((await fetchTts('Hi', SESSION, new AbortController().signal)).kind).toBe('ok');
      expect((await fetchTts('Hi', SESSION)).kind).toBe('ok');
    });

    it('still times out on its own after 8 seconds when a signal is given', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      );
      const pending = fetchTts('Hi', SESSION, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(TTS_TIMEOUT_MS + 1);
      expect(await pending).toEqual({ kind: 'unavailable' });
    });

    it('times out', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      );
      const pending = fetchTts('Hi', SESSION);
      await vi.advanceTimersByTimeAsync(TTS_TIMEOUT_MS + 1);
      expect(await pending).toEqual({ kind: 'unavailable' });
    });
  });

  describe('fetchVoiceCaps', () => {
    it('GETs {base}/health and returns the voice block', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { ok: true, voice: { stt: true, tts: 'server', provider: 'elevenlabs', configured: true } })
      );
      expect(await fetchVoiceCaps()).toEqual({ tts: 'server' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:8787/health');
      expect(init.method ?? 'GET').toBe('GET');
      expect(init.credentials).toBe('omit');
    });

    it('the server voice is on only for tts "server", whichever provider, unless it says it is not configured', async () => {
      for (const voice of [
        { tts: 'server', provider: 'elevenlabs', configured: true },
        { tts: 'server', provider: 'aura' },
        { tts: 'server' }, // no `configured` field: not "false"
      ]) {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { voice: { stt: true, ...voice } }));
        expect(await fetchVoiceCaps(), JSON.stringify(voice)).toEqual({ tts: 'server' });
      }
    });

    it('everything else is text only, an allow-list not a deny-list: "browser", "none", the old "aura", anything unknown, nothing', async () => {
      const others: Array<Record<string, unknown>> = [
        { tts: 'browser' },
        { tts: 'browser', provider: 'none', configured: true },
        { tts: 'none' },
        { tts: 'aura' }, // the older value no longer switches anything on
        { tts: 'aura', configured: true },
        { tts: 'whatever' },
        { tts: 'Server' }, // not an exact match
        { tts: false },
        { tts: null },
        { tts: 1 },
        {},
      ];
      for (const voice of others) {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { voice: { stt: true, ...voice } }));
        expect(await fetchVoiceCaps(), JSON.stringify(voice)).toEqual({ tts: 'none' });
      }
    });

    it('a server voice that is not configured is text only too', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { voice: { stt: true, tts: 'server', provider: 'elevenlabs', configured: false } })
      );
      expect(await fetchVoiceCaps()).toEqual({ tts: 'none' });
    });

    it('is null, without a second request, when the Worker plainly has no voice', async () => {
      const answers: Response[] = [
        jsonResponse(200, { ok: true }),
        jsonResponse(200, { voice: { stt: false, tts: 'browser' } }),
        jsonResponse(404, { error: 'not_found' }),
        new Response('<html>', { status: 200 }),
      ];
      for (const answer of answers) {
        fetchMock.mockClear();
        fetchMock.mockResolvedValueOnce(answer);
        expect(await fetchVoiceCaps()).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
    });

    it('tries once more after a network failure or a server error, and uses the second answer', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('offline'));
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { voice: { stt: true, tts: 'none' } }));
      expect(await fetchVoiceCaps()).toEqual({ tts: 'none' });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      fetchMock.mockClear();
      fetchMock.mockResolvedValueOnce(jsonResponse(502, { error: 'bad_gateway' }));
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { voice: { stt: true, tts: 'server' } }));
      expect(await fetchVoiceCaps()).toEqual({ tts: 'server' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('gives up after one retry when the trouble lasts', async () => {
      fetchMock.mockRejectedValue(new TypeError('offline'));
      expect(await fetchVoiceCaps()).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      fetchMock.mockReset();
      fetchMock.mockResolvedValue(jsonResponse(500, { error: 'x' }));
      expect(await fetchVoiceCaps()).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('a timeout counts as trouble: one retry, each attempt limited to the health timeout', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      );
      const pending = fetchVoiceCaps();
      await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS + 1);
      await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS + 1);
      expect(await pending).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
