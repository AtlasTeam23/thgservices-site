import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The page-load read of /health (voice/health.ts): one request for the whole page, only where voice can
// exist, reusable by the panel's own check. (fetchVoiceCaps itself, the request and the allow-list that
// reads the answer, is covered in voiceApi.test.ts through api.ts, which re-exports it.)

const mic = vi.hoisted(() => ({ supported: true }));
vi.mock('../voice/support', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../voice/support')>()),
  isRecordingSupported: vi.fn(() => mic.supported),
}));

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
    mic.supported = true;
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
    expect(await sharedVoiceCaps()).toBeNull();
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

  it('a failed request leaves it unknown, with nothing for the panel to reuse, and the next ask tries again', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    prefetchVoiceCaps();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2); // the request and its one retry
    expect(voiceHealth()).toBe('unknown');
    expect(await sharedVoiceCaps()).toBeNull();

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(answer('server'));
    prefetchVoiceCaps();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(voiceHealth()).toBe('server');
  });

  it('a Worker with no speech to text is "unknown", never a server voice', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ voice: { stt: false, tts: 'server' } }), { status: 200 })
    );
    prefetchVoiceCaps();
    await flush();
    expect(voiceHealth()).toBe('unknown');
  });

  it('does nothing in a browser that cannot record: no mic, no voice, nothing to ask about', async () => {
    mic.supported = false;
    prefetchVoiceCaps();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(voiceHealth()).toBe('unknown');
  });
});
