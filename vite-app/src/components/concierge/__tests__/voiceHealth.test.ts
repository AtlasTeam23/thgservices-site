import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The page-load read of /health (voice/health.ts): one request for the whole page, reusable by the
// panel's own check, and decided by the server voice alone (never by speech to text or the browser's mic). (fetchVoiceCaps itself, the request and the allow-list that
// reads the answer, is covered in voiceApi.test.ts through api.ts, which re-exports it.)

import { prefetchVoiceCaps, resetVoiceHealth, sharedVoiceCaps, voiceHealth } from '../voice/health';

const answer = (tts: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ ok: true, voice: { stt: true, tts, ...extra } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('the page-load /health read', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetVoiceHealth();
    vi.stubEnv('VITE_CONCIERGE_API_URL', 'http://localhost:8787');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('is not known until it has been asked', async () => {
    expect(voiceHealth()).toBe('unknown');
    expect(await sharedVoiceCaps()).toBeUndefined(); // nothing to reuse: the panel asks for itself
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks once, and remembers a server voice', async () => {
    fetchMock.mockResolvedValue(answer('server', { configured: true }));
    prefetchVoiceCaps();
    await flush();
    expect(voiceHealth()).toBe('server');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8787/health');
    expect(await sharedVoiceCaps()).toEqual({ tts: 'server' });

    prefetchVoiceCaps(); // answered: nothing more to ask
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('remembers "none" too (and then does not ask again either)', async () => {
    fetchMock.mockResolvedValue(answer('none'));
    prefetchVoiceCaps();
    await flush();
    expect(voiceHealth()).toBe('none');
    expect(await sharedVoiceCaps()).toEqual({ tts: 'none' });
    prefetchVoiceCaps();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never sends a second request while the first is in flight, and the panel can wait for it', async () => {
    let respond!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (respond = resolve)));
    prefetchVoiceCaps();
    prefetchVoiceCaps();
    prefetchVoiceCaps();
    const panel = sharedVoiceCaps();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(voiceHealth()).toBe('unknown');

    respond(answer('server'));
    expect(await panel).toEqual({ tts: 'server' });
    expect(voiceHealth()).toBe('server');
  });

  describe('a Worker that answered "no voice" is an answer, and nothing asks it again', () => {
    for (const [label, response] of [
      ['stt is off and replies are not read aloud', () => new Response(JSON.stringify({ voice: { stt: false, tts: 'browser' } }), { status: 200 })],
      ['there is no voice block', () => new Response(JSON.stringify({ ok: true }), { status: 200 })],
      ['the voice block is not an object', () => new Response(JSON.stringify({ voice: 'on' }), { status: 200 })],
      ['the JSON is not even an object', () => new Response('null', { status: 200 })],
      ['the server voice is not configured', () => answer('server', { configured: false })],
      ['replies are not read aloud', () => answer('browser')],
      ['it says 404', () => new Response('{}', { status: 404 })],
      ['it says 403', () => new Response('{}', { status: 403 })],
    ] as const) {
      it(`when ${label}: "none", one request, no retry, and not asked again`, async () => {
        fetchMock.mockImplementation(async () => response());
        prefetchVoiceCaps();
        await flush();
        expect(voiceHealth()).toBe('none');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        prefetchVoiceCaps(); // what a click does when it finds no answer: there is one
        prefetchVoiceCaps();
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    }

    it('and the panel is told it as it is: no voice (null), not "ask for yourself" (undefined)', async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      prefetchVoiceCaps();
      await flush();
      expect(await sharedVoiceCaps()).toBeNull();
    });

    it('while a text-only voice (replies not read aloud) is still caps for the panel', async () => {
      fetchMock.mockResolvedValue(answer('none'));
      prefetchVoiceCaps();
      await flush();
      expect(voiceHealth()).toBe('none');
      expect(await sharedVoiceCaps()).toEqual({ tts: 'none' });
    });
  });

  describe('a failure is not an answer, and the next ask tries again', () => {
    const failures: Array<[string, () => Promise<Response>, number]> = [
      ['the network is down', () => Promise.reject(new TypeError('offline')), 2],
      ['the Worker errors (5xx)', async () => new Response('{}', { status: 502 }), 2],
      ['the answer is not JSON', async () => new Response('<html>', { status: 200 }), 1],
    ];
    for (const [label, respond, requests] of failures) {
      it(`when ${label}: unknown, nothing for the panel to reuse, and asked again`, async () => {
        fetchMock.mockImplementation(respond);
        prefetchVoiceCaps();
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(requests);
        expect(voiceHealth()).toBe('unknown');
        expect(await sharedVoiceCaps()).toBeUndefined();

        fetchMock.mockReset();
        fetchMock.mockResolvedValue(answer('server'));
        prefetchVoiceCaps();
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(voiceHealth()).toBe('server');
        expect(await sharedVoiceCaps()).toEqual({ tts: 'server' });
      });
    }

    it('when it times out: unknown too', async () => {
      vi.useFakeTimers();
      try {
        fetchMock.mockImplementation(
          (_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            })
        );
        prefetchVoiceCaps();
        await vi.advanceTimersByTimeAsync(5001);
        await vi.advanceTimersByTimeAsync(5001);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(voiceHealth()).toBe('unknown');
        expect(await sharedVoiceCaps()).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('a failure after a success never undoes it', async () => {
      fetchMock.mockResolvedValue(answer('server'));
      prefetchVoiceCaps();
      await flush();
      fetchMock.mockReset();
      fetchMock.mockRejectedValue(new TypeError('offline'));
      prefetchVoiceCaps();
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(voiceHealth()).toBe('server');
    });
  });

  it('stt: false with a configured server voice is server mode (there is no voice input to wait for)', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, voice: { stt: false, tts: 'server', provider: 'elevenlabs', configured: true } }),
        { status: 200 }
      )
    );
    prefetchVoiceCaps();
    await flush();
    expect(voiceHealth()).toBe('server');
    expect(await sharedVoiceCaps()).toEqual({ tts: 'server' });
  });

  it('asks in a browser with no microphone API at all', async () => {
    const mediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    try {
      fetchMock.mockResolvedValue(answer('server', { stt: false, configured: true }));
      prefetchVoiceCaps();
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(voiceHealth()).toBe('server');
    } finally {
      if (mediaDevices) Object.defineProperty(navigator, 'mediaDevices', mediaDevices);
      else delete (navigator as unknown as Record<string, unknown>).mediaDevices;
    }
  });
});
