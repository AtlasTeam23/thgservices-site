import { reset } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/index';
import { globalTtsName, ttsIpName, ttsSpokenIpName } from '../src/limits';
import { call, captureLogs, chatOnce, fixedCount, randomIp, randomUuid, slidingCount, testEnv } from './helpers';

// Every call to ElevenLabs here goes to a stubbed fetch: there is no key in this repo and the suite never
// touches the network. What these tests pin is the request the Worker WOULD send, built from the published
// API contract (POST /v1/text-to-speech/{voice_id}/stream, header xi-api-key, JSON body), and what it does
// with each kind of answer.

const KEY = 'sk_placeholder_not_a_real_key_0123456789';
const VOICE = '21m00Tcm4TlvDq8ikWAM';
const MP3 = Uint8Array.from([0xff, 0xf3, 0x60, 0xc4, 0, 1, 2, 3, 4, 5, 6, 7]);

const app = createApp({ voice: { retryDelayMs: 0, timeoutMs: 40 } });

let session = '';
const body = (text: unknown, sessionId: unknown = session) => ({ sessionId, text });
const post = (payload: unknown, options: Parameters<typeof call>[1] = {}) => call('/tts', { body: payload, app, ...options });

/** ElevenLabs selected and fully configured; the per-visitor cap is lifted here because other tests cover it. */
const elevenEnv = (extra: Record<string, unknown> = {}) =>
  testEnv({
    VOICE_TTS: 'elevenlabs',
    ELEVENLABS_API_KEY: KEY,
    VOICE_ELEVEN_VOICE_ID: VOICE,
    VOICE_TTS_PER_IP_PER_DAY: '1000',
    ...extra,
  });

interface ElevenCall {
  url: string;
  init: RequestInit;
  headers: Headers;
  body: Record<string, any>;
}

const audio = (headers: HeadersInit = { 'Content-Type': 'audio/mpeg' }) => new Response(MP3, { status: 200, headers });

/** Replaces fetch: only api.elevenlabs.io is reachable, and `respond` decides each answer. Returns the calls it saw. */
const stubEleven = (respond: (call: ElevenCall) => Response | Promise<Response> = () => audio()) => {
  const calls: ElevenCall[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (new URL(url).host !== 'api.elevenlabs.io') throw new Error(`unexpected network call to ${url}`);
    const entry: ElevenCall = {
      url,
      init: init ?? {},
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    };
    calls.push(entry);
    return respond(entry);
  });
  return calls;
};

beforeEach(async () => {
  await reset();
  session = await chatOnce();
});
afterEach(() => vi.restoreAllMocks());

describe('POST /tts with ElevenLabs: the request it sends', () => {
  it('posts to the streaming endpoint for the configured voice, with the key in xi-api-key', async () => {
    const calls = stubEleven();
    const res = await post(body('Hello there.'), { env: elevenEnv() });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const [sent] = calls;
    expect(sent!.url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/stream?output_format=mp3_22050_32`);
    expect(sent!.init.method).toBe('POST');
    expect(sent!.headers.get('xi-api-key')).toBe(KEY);
    expect(sent!.headers.get('content-type')).toBe('application/json');
  });

  it('sends the text, Flash, the fixed voice settings and automatic text normalization, and nothing else', async () => {
    const calls = stubEleven();
    await post(body('Hello there.'), { env: elevenEnv() });
    expect(calls[0]!.body).toEqual({
      text: 'Hello there.',
      model_id: 'eleven_flash_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
      apply_text_normalization: 'auto',
    });
  });

  it('does not follow redirects (manual, the only non-following mode the Workers runtime accepts)', async () => {
    const calls = stubEleven();
    await post(body('Hello there.'), { env: elevenEnv() });
    // redirect: 'error' is rejected by workerd with a TypeError before any request is made.
    expect(calls[0]!.init.redirect).toBe('manual');
  });

  it('treats a redirect answer as a failure and never calls the redirect target with the key', async () => {
    const calls = stubEleven(
      () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/collect' } }),
    );
    const res = await post(body('Hello there.'), { env: elevenEnv() });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).host).toBe('api.elevenlabs.io');
  });

  it('gives fetch an abort signal, so a stuck call can be cut off', async () => {
    const calls = stubEleven();
    await post(body('Hello there.'), { env: elevenEnv() });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect((calls[0]!.init.signal as AbortSignal).aborted).toBe(false);
  });

  it('uses the voice, model and format from the vars', async () => {
    const calls = stubEleven();
    await post(body('Hello there.'), {
      env: elevenEnv({ VOICE_ELEVEN_VOICE_ID: 'AZnzlk1XvdvUeBnXmlld', VOICE_ELEVEN_MODEL: 'eleven_turbo_v2_5', VOICE_ELEVEN_FORMAT: 'mp3_44100_128' }),
    });
    expect(calls[0]!.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/AZnzlk1XvdvUeBnXmlld/stream?output_format=mp3_44100_128');
    expect(calls[0]!.body.model_id).toBe('eleven_turbo_v2_5');
  });

  it('falls back to the 22 kHz MP3 for a format that is not an MP3 (the audio is labelled audio/mpeg)', async () => {
    const calls = stubEleven();
    await post(body('Hello there.'), { env: elevenEnv({ VOICE_ELEVEN_FORMAT: 'pcm_16000' }) });
    expect(calls[0]!.url).toContain('output_format=mp3_22050_32');
  });

  it('sends the sanitized text: markup and control characters removed', async () => {
    const calls = stubEleven();
    await post(body('<b>Hello</b>\u0000 there.'), { env: elevenEnv() });
    expect(calls[0]!.body.text).toBe('Hello there.');
  });

  it('counts the sanitized length against the same daily character budget as Aura', async () => {
    stubEleven();
    const env = elevenEnv();
    await post(body('<b>Hello</b> there.'), { env });
    expect(await fixedCount(env, globalTtsName())).toBe(12); // 'Hello there.'
  });
});

describe('POST /tts with ElevenLabs: what it counts for the address', () => {
  it('counts one request in the abuse counter and one reply in the spoken-reply counter, for that address only', async () => {
    stubEleven();
    const env = elevenEnv();
    const ip = randomIp();
    const other = randomIp();
    expect((await post(body('Hello there.'), { env, ip })).status).toBe(200);
    expect(await slidingCount(env, await ttsIpName(ip, env.RATE_SALT))).toBe(1);
    expect(await fixedCount(env, await ttsSpokenIpName(ip, env.RATE_SALT))).toBe(1);
    expect(await slidingCount(env, await ttsIpName(other, env.RATE_SALT))).toBe(0);
    expect(await fixedCount(env, await ttsSpokenIpName(other, env.RATE_SALT))).toBe(0);
  });
});

describe('POST /tts with ElevenLabs: the answer it returns', () => {
  it('proxies the audio bytes as audio/mpeg, no-store, with CORS', async () => {
    stubEleven();
    const res = await post(body('Hello there.'), { env: elevenEnv() });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://thgservices.io');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(MP3));
  });

  it.each([
    ['says nothing about the type (the API reference does not state one)', {}],
    ['calls it a binary stream', { 'Content-Type': 'application/octet-stream' }],
    ['calls it something else entirely', { 'Content-Type': 'text/html' }],
  ])('says audio/mpeg itself when ElevenLabs %s', async (_label, headers) => {
    stubEleven(() => audio(headers));
    const res = await post(body('Hello there.'), { env: elevenEnv() });
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
  });

  it("passes none of ElevenLabs' own headers on to the browser", async () => {
    stubEleven(() => audio({ 'Content-Type': 'audio/mpeg', 'request-id': 'abc', 'character-cost': '12', 'set-cookie': 'a=b', 'x-powered-by': 'x', 'Content-Disposition': 'attachment' }));
    const res = await post(body('Hello there.'), { env: elevenEnv() });
    for (const name of ['request-id', 'character-cost', 'set-cookie', 'x-powered-by', 'content-disposition']) {
      expect(res.headers.has(name), name).toBe(false);
    }
  });

  it('streams: the first bytes arrive while ElevenLabs is still speaking', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    stubEleven(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              controller.enqueue(Uint8Array.from([1, 2, 3]));
              await gate;
              controller.enqueue(Uint8Array.from([4, 5, 6]));
              controller.close();
            },
          }),
        ),
    );
    const res = await post(body('A long reply.'), { env: elevenEnv() });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    expect(Array.from((await reader.read()).value!)).toEqual([1, 2, 3]);
    release();
    expect(Array.from((await reader.read()).value!)).toEqual([4, 5, 6]);
    expect((await reader.read()).done).toBe(true);
  });
});

describe('POST /tts with ElevenLabs when the visitor goes away, or ElevenLabs does, mid-reply', () => {
  // The handler has already returned the response by then, so what matters is that nothing throws later and no
  // rejection is left unhandled.
  const unhandled: unknown[] = [];
  const onUnhandled = (event: Event) => {
    unhandled.push(event);
  };
  beforeEach(() => {
    unhandled.length = 0;
    (globalThis as { addEventListener?: (type: string, fn: (e: Event) => void) => void }).addEventListener?.('unhandledrejection', onUnhandled);
  });
  afterEach(() => {
    (globalThis as { removeEventListener?: (type: string, fn: (e: Event) => void) => void }).removeEventListener?.('unhandledrejection', onUnhandled);
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  it('passes the visitor\'s cancel on to ElevenLabs, throws nothing, and still counts the reply that had started', async () => {
    let upstreamCancelled = false;
    stubEleven(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(Uint8Array.from([1, 2, 3]));
            },
            cancel() {
              upstreamCancelled = true;
            },
          }),
        ),
    );
    const env = elevenEnv();
    const ip = randomIp();
    const res = await post(body('A long reply.'), { env, ip });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    expect(Array.from((await reader.read()).value!)).toEqual([1, 2, 3]);
    await reader.cancel(); // the visitor closes the tab / the widget stops the audio
    await settle();
    expect(upstreamCancelled).toBe(true);
    expect(unhandled).toHaveLength(0);
    expect(await fixedCount(env, await ttsSpokenIpName(ip, env.RATE_SALT))).toBe(1); // audio had started: it counts
    expect((await post(body('Next.'), { env })).status).toBe(200); // and the Worker carries on
  });

  it('cancelling before reading anything is fine too', async () => {
    let upstreamCancelled = false;
    stubEleven(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(Uint8Array.from([1, 2, 3]));
            },
            cancel() {
              upstreamCancelled = true;
            },
          }),
        ),
    );
    const res = await post(body('A long reply.'), { env: elevenEnv() });
    await res.body!.cancel();
    await settle();
    expect(upstreamCancelled).toBe(true);
    expect(unhandled).toHaveLength(0);
  });

  it('a stream that dies in the middle reaches the visitor as a failed read, and nothing is left unhandled', async () => {
    stubEleven(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(Uint8Array.from([1, 2, 3]));
            },
            pull(controller) {
              controller.error(new Error('upstream died'));
            },
          }),
        ),
    );
    const res = await post(body('A long reply.'), { env: elevenEnv() });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    expect(Array.from((await reader.read()).value!)).toEqual([1, 2, 3]);
    await expect(reader.read()).rejects.toThrow();
    await settle();
    expect(unhandled).toHaveLength(0);
  });
});

describe('POST /tts with ElevenLabs when it is not set up', () => {
  const unconfigured = async (extra: Record<string, unknown>) => {
    const calls = stubEleven();
    const env = elevenEnv(extra);
    const ip = randomIp();
    const res = await post(body('Hello there.'), { env, ip });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
    expect(calls).toHaveLength(0); // nothing was sent anywhere
    expect(await fixedCount(env, globalTtsName())).toBe(0); // nothing was charged to the day
    // Nothing was counted for this address either: not its spoken replies, and not even the abuse counter.
    expect(await fixedCount(env, await ttsSpokenIpName(ip, env.RATE_SALT))).toBe(0);
    expect(await slidingCount(env, await ttsIpName(ip, env.RATE_SALT))).toBe(0);
  };

  it('answers 503 reason "server" when no voice id has been chosen', async () => {
    await unconfigured({ VOICE_ELEVEN_VOICE_ID: '' });
    await reset();
    session = await chatOnce();
    await unconfigured({ VOICE_ELEVEN_VOICE_ID: undefined });
  });

  it('answers 503 reason "server" when the key is missing', async () => {
    await unconfigured({ ELEVENLABS_API_KEY: undefined });
    await reset();
    session = await chatOnce();
    await unconfigured({ ELEVENLABS_API_KEY: '   ' });
  });

  it('answers 503 reason "server" for a voice id that cannot go into a URL path', async () => {
    await unconfigured({ VOICE_ELEVEN_VOICE_ID: '../voices' });
  });
});

describe('POST /tts with ElevenLabs when the provider fails', () => {
  const failure = async (respond: Parameters<typeof stubEleven>[0]) => {
    const logs = captureLogs();
    const calls = stubEleven(respond);
    const res = await post(body('Hello there.'), { env: elevenEnv() });
    return { res, calls, logs };
  };

  it.each([
    [401, 'a rejected key'],
    [402, 'payment required'],
    [422, 'a validation error'],
    [429, 'too many requests or concurrency'],
    [500, 'a server error'],
    [503, 'unavailable'],
    [201, 'a success code that is not 200'],
    [206, 'partial content'],
  ])('answers 503 reason "server" for HTTP %i (%s), and says nothing else', async (status) => {
    const { res, calls } = await failure(() => new Response('{"detail":{"status":"quota_exceeded","message":"secret provider text"}}', { status }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
    expect(calls).toHaveLength(1); // not retried
  });

  it('logs only the provider and the status, never the provider body, the text or the key', async () => {
    const { logs } = await failure(
      () => new Response(`{"detail":[{"msg":"Hello there. ${KEY} quota_exceeded"}]}`, { status: 422 }),
    );
    const lines = logs.filter((line) => line.includes('"event":"tts_error"')).map((line) => JSON.parse(line));
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]).sort()).toEqual(['event', 'ms', 'provider', 'status']);
    expect(lines[0]).toMatchObject({ event: 'tts_error', provider: 'elevenlabs', status: 422 });
    const all = logs.join('\n');
    expect(all).not.toContain(KEY);
    expect(all).not.toContain('quota_exceeded');
    expect(all).not.toContain('Hello there');
    expect(all).not.toContain(session);
  });

  it('logs the final tts line with status 503 and the provider name', async () => {
    const { logs } = await failure(() => new Response('no', { status: 500 }));
    const final = JSON.parse(logs.filter((line) => line.includes('"event":"tts"')).at(-1)!);
    expect(Object.keys(final).sort()).toEqual(['chars', 'event', 'ms', 'provider', 'status']);
    expect(final).toMatchObject({ event: 'tts', provider: 'elevenlabs', status: 503, chars: 12 });
  });

  it('answers 503 reason "server" when a 200 arrives with no body', async () => {
    const { res } = await failure(() => new Response(null, { status: 200 }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
  });

  it('answers 503 reason "server" when the network call throws, logging the error name and no message', async () => {
    const { res, logs } = await failure(() => {
      throw new TypeError(`network down while sending ${KEY} Hello there.`);
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
    const line = JSON.parse(logs.find((l) => l.includes('"event":"tts_error"'))!);
    expect(Object.keys(line).sort()).toEqual(['error', 'event', 'ms', 'provider']);
    expect(line).toMatchObject({ provider: 'elevenlabs', error: 'TypeError' });
    expect(logs.join('\n')).not.toContain(KEY);
    expect(logs.join('\n')).not.toContain('Hello there');
  });

  it('gives up after the timeout, aborts the request, and does not retry', async () => {
    let signal: AbortSignal | undefined;
    const logs = captureLogs();
    const calls = stubEleven((entry) => {
      signal = entry.init.signal as AbortSignal;
      return new Promise<Response>(() => undefined); // never answers
    });
    const started = performance.now();
    const res = await post(body('Hello there.'), { env: elevenEnv() });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
    expect(performance.now() - started).toBeLessThan(500);
    expect(calls).toHaveLength(1);
    expect(signal?.aborted).toBe(true);
    expect(logs.some((line) => line.includes('"error":"AiTimeoutError"') && line.includes('"provider":"elevenlabs"'))).toBe(true);
  });
});

describe('POST /tts with ElevenLabs keeps the same guards as Aura', () => {
  it('needs a session that has chatted, and a session that is not ended', async () => {
    const calls = stubEleven();
    const env = elevenEnv();
    const unchatted = await post(body('Hello there.', randomUuid()), { env });
    expect(unchatted.status).toBe(403);
    expect(await unchatted.json()).toEqual({ error: 'no_chat' });
    const ended = await call('/chat', { body: { sessionId: session, messages: [{ role: 'user', content: 'you are a fucking idiot' }] } });
    expect(ended.status).toBe(403);
    expect((await post(body('Hello there.'), { env })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('answers 503 reason "budget" before calling ElevenLabs once the day\'s characters are spent', async () => {
    const calls = stubEleven();
    const env = elevenEnv({ VOICE_DAILY_TTS_CHARS: '12' });
    expect((await post(body('Hello there.'), { env })).status).toBe(200);
    const over = await post(body('Hello there.'), { env });
    expect(over.status).toBe(503);
    expect(await over.json()).toEqual({ error: 'voice_unavailable', reason: 'budget' });
    expect(calls).toHaveLength(1);
  });

  it('allows 30 requests per address in 10 minutes and answers the 31st with 429 rate_limited', async () => {
    const calls = stubEleven();
    const env = elevenEnv();
    const ip = randomIp();
    for (let i = 1; i <= 30; i += 1) expect((await post(body('Hi.'), { env, ip })).status, `request ${i}`).toBe(200);
    const res = await post(body('Hi.'), { env, ip });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(calls).toHaveLength(30);
  });

  it('answers the CORS preflight like the other provider', async () => {
    const res = await call('/tts', { method: 'OPTIONS', app, env: elevenEnv(), headers: { 'Access-Control-Request-Method': 'POST' } });
    expect(res.status).toBe(204);
  });
});

describe('POST /tts with ElevenLabs never shows the key', () => {
  it('keeps it out of every response body and header, and every log line, on success and on failure', async () => {
    const logs = captureLogs();
    stubEleven((entry) => (entry.body.text === 'Fail now.' ? new Response('nope', { status: 401 }) : audio()));
    const env = elevenEnv();
    const ok = await post(body('Hello there.'), { env });
    const failed = await post(body('Fail now.'), { env });
    for (const res of [ok, failed]) {
      expect([...res.headers.entries()].join('\n')).not.toContain(KEY);
      expect(await res.text()).not.toContain(KEY);
    }
    expect(logs.join('\n')).not.toContain(KEY);
    expect((await (await call('/health', { env })).text())).not.toContain(KEY);
  });
});
