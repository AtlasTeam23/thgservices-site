import { reset } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENDED } from '../src/copy';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import { globalTtsName } from '../src/limits';
import { aiStub, call, captureLogs, chatOnce, fixedCount, messagesUsed, randomIp, randomUuid, testEnv } from './helpers';

const MODEL = '@cf/deepgram/aura-1';

const MP3 = Uint8Array.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5, 6, 7, 8]); // the look of an MPEG frame, not real audio
const speech = () => new Response(MP3, { headers: { 'Content-Type': 'audio/mpeg' } });

// A short timeout so the failure path does not wait 15 seconds.
const app = createApp({ voice: { retryDelayMs: 0, timeoutMs: 40 } });

// /tts speaks replies, so it only serves a session that has chatted: `session` has sent one message.
let session = '';
const body = (text: unknown, sessionId: unknown = session) => ({ sessionId, text });
const post = (payload: unknown, options: Parameters<typeof call>[1] = {}) => call('/tts', { body: payload, app, ...options });

/** Premium voice switched on, with a stub that returns an MPEG response. */
const auraEnv = (ai: Env['AI'] = aiStub(speech).ai, extra: Record<string, unknown> = {}) =>
  testEnv({ AI: ai, VOICE_TTS: 'aura', VOICE_TTS_PER_IP_PER_DAY: '1000', ...extra }); // the per-visitor cap has its own tests

beforeEach(async () => {
  await reset();
  session = await chatOnce();
});
afterEach(() => vi.restoreAllMocks());

describe('POST /tts behind the flag', () => {
  it.each([
    ['VOICE_TTS is browser', { VOICE_TTS: 'browser' }],
    ['VOICE_TTS is missing', { VOICE_TTS: undefined }],
    ['VOICE_TTS is something else', { VOICE_TTS: 'eleven' }],
  ])('answers 404 when %s, without touching the model or a counter', async (_label, vars) => {
    const stub = aiStub(speech);
    const sessionId = randomUuid();
    const env = testEnv({ AI: stub.ai, ...vars });
    const res = await post(body('Hello there.', sessionId), { env });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(stub.run).not.toHaveBeenCalled();
    expect(await fixedCount(env, globalTtsName())).toBe(0);
  });

  it('is a 404 for a GET too while the flag is off, and a 405 once it is on', async () => {
    expect((await call('/tts', { method: 'GET', app, env: testEnv({ AI: aiStub().ai }) })).status).toBe(404);
    const on = await call('/tts', { method: 'GET', app, env: auraEnv() });
    expect(on.status).toBe(405);
    expect(on.headers.get('Allow')).toBe('POST, OPTIONS');
  });

  it('answers 503 with reason "server" when the flag is on but there is no AI binding', async () => {
    const res = await post(body('Hello there.'), { env: testEnv({ AI: undefined, VOICE_TTS: 'aura' }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
  });

  it('still answers the CORS preflight with the flag off (preflight is handled before routing), and with it on', async () => {
    for (const env of [testEnv({ AI: aiStub().ai }), auraEnv()]) {
      const res = await call('/tts', { method: 'OPTIONS', app, env, headers: { 'Access-Control-Request-Method': 'POST' } });
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://thgservices.io');
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    }
  });

  it('accepts the flag in any case, with spaces around it', async () => {
    const res = await post(body('Hello there.'), { env: auraEnv(undefined, { VOICE_TTS: ' Aura ' }) });
    expect(res.status).toBe(200);
  });
});

describe('POST /tts happy path', () => {
  it('returns the model audio as audio/mpeg', async () => {
    const res = await post(body('Hello there.'), { env: auraEnv() });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://thgservices.io');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(MP3));
  });

  it('calls Aura-1 with the text, the default speaker and MP3 asked for by name, wanting the raw response', async () => {
    const stub = aiStub(speech);
    await post(body('Hello there.'), { env: auraEnv(stub.ai) });
    expect(stub.run).toHaveBeenCalledTimes(1);
    const [model, input, options] = stub.run.mock.calls[0]!;
    expect(model).toBe(MODEL);
    expect(input).toEqual({ text: 'Hello there.', speaker: 'asteria', encoding: 'mp3' });
    expect(options).toMatchObject({ returnRawResponse: true });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses VOICE_SPEAKER when it names an Aura speaker, and asteria otherwise', async () => {
    captureLogs(); // the second call logs the fallback
    const stub = aiStub(speech);
    await post(body('One.'), { env: auraEnv(stub.ai, { VOICE_SPEAKER: 'luna' }) });
    await post(body('Two.'), { env: auraEnv(stub.ai, { VOICE_SPEAKER: 'not-a-voice' }) });
    expect(stub.run.mock.calls.map((call) => call[1].speaker)).toEqual(['luna', 'asteria']);
  });

  it('passes the stream through as it arrives instead of waiting for all of it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const stub = aiStub(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              controller.enqueue(Uint8Array.from([1, 2, 3]));
              await gate; // the second half exists only after the test says so
              controller.enqueue(Uint8Array.from([4, 5, 6]));
              controller.close();
            },
          }),
        ),
    );
    const res = await post(body('A long reply.'), { env: auraEnv(stub.ai) });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    expect(Array.from((await reader.read()).value!)).toEqual([1, 2, 3]); // arrived while the model was still "speaking"
    release();
    expect(Array.from((await reader.read()).value!)).toEqual([4, 5, 6]);
    expect((await reader.read()).done).toBe(true);
  });

  it('says audio/mpeg whatever label the raw response carried', async () => {
    const stub = aiStub(() => new Response(MP3, { headers: { 'Content-Type': 'application/octet-stream' } }));
    const res = await post(body('Hello.'), { env: auraEnv(stub.ai) });
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
  });

  it('sends the model sanitized text: markup and control characters removed', async () => {
    const stub = aiStub(speech);
    await post(body('<b>Hello</b>\u0000 there.'), { env: auraEnv(stub.ai) });
    expect(stub.run.mock.calls[0]![1].text).toBe('Hello there.');
  });

  it('does not count as a chat message', async () => {
    const env = auraEnv();
    await post(body('Hello there.'), { env });
    await post(body('Hello again.'), { env });
    expect(await messagesUsed(env, session)).toBe(1); // only the one chat message the session sent
  });
});

describe('POST /tts needs a session that has chatted and is not ended', () => {
  it('refuses a session that has sent no chat message with 403 no_chat, before any model call or charge', async () => {
    const stub = aiStub(speech);
    const env = auraEnv(stub.ai);
    const res = await post(body('Hello there.', randomUuid()), { env });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'no_chat' });
    expect(stub.run).not.toHaveBeenCalled();
    expect(await fixedCount(env, globalTtsName())).toBe(0);
  });

  it('reads the session without recording anything on it', async () => {
    const env = auraEnv();
    const fresh = randomUuid();
    await post(body('Hello there.', fresh), { env });
    expect(await messagesUsed(env, fresh)).toBe(0);
  });

  it('serves the same session as soon as it has chatted', async () => {
    const stub = aiStub(speech);
    const env = auraEnv(stub.ai);
    const fresh = randomUuid();
    expect((await post(body('Hello there.', fresh), { env })).status).toBe(403);
    await chatOnce(fresh);
    expect((await post(body('Hello there.', fresh), { env })).status).toBe(200);
    expect(stub.run).toHaveBeenCalledTimes(1);
  });

  it('refuses a session that /chat ended, with the same 403 ended', async () => {
    const stub = aiStub(speech);
    const env = auraEnv(stub.ai);
    const ended = await call('/chat', { body: { sessionId: session, messages: [{ role: 'user', content: 'you are a fucking idiot' }] } });
    expect(ended.status).toBe(403);
    const res = await post(body('Hello there.'), { env });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'ended', reply: ENDED });
    expect(stub.run).not.toHaveBeenCalled();
  });

  it("still applies the address's limit first, so probing with unchatted sessions is bounded", async () => {
    const env = auraEnv();
    const ip = randomIp();
    for (let i = 1; i <= 30; i += 1) expect((await post(body('Hi.', randomUuid()), { env, ip })).status, `probe ${i}`).toBe(403);
    const res = await post(body('Hi.'), { env, ip }); // even a chatted session is now refused for this address
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
  });
});

describe('POST /tts model and voice', () => {
  const AURA_1_ID = '@cf/deepgram/aura-1';
  const AURA_2_ID = '@cf/deepgram/aura-2-en';

  /** The model call a request made, given the voice vars. */
  const modelCall = async (vars: Record<string, unknown>) => {
    const stub = aiStub(speech);
    const res = await post(body('Hello there.'), { env: auraEnv(stub.ai, vars) });
    expect(res.status).toBe(200);
    expect(stub.run).toHaveBeenCalledTimes(1);
    const [model, input, options] = stub.run.mock.calls[0]!;
    return { model, input, options };
  };

  it.each([
    ['unset', undefined],
    ['aura-1', 'aura-1'],
    ['an unknown name', 'aura-3'],
    ['a model id instead of the short name', '@cf/deepgram/aura-2-en'],
  ])('uses Aura-1 when VOICE_TTS_MODEL is %s', async (_label, value) => {
    const { model, input } = await modelCall({ VOICE_TTS_MODEL: value });
    expect(model).toBe(AURA_1_ID);
    expect(input).toEqual({ text: 'Hello there.', speaker: 'asteria', encoding: 'mp3' });
  });

  it.each(['aura-2', ' AURA-2 '])('uses Aura-2 (%j), with the same encoding and raw-response options', async (value) => {
    const { model, input, options } = await modelCall({ VOICE_TTS_MODEL: value });
    expect(model).toBe(AURA_2_ID);
    expect(input).toEqual({ text: 'Hello there.', speaker: 'asteria', encoding: 'mp3' });
    expect(options).toMatchObject({ returnRawResponse: true });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['thalia', 'andromeda', 'helena', 'apollo', 'arcas', 'orion'])('sends the Aura-2 speaker %s as a bare name', async (speaker) => {
    const { model, input } = await modelCall({ VOICE_TTS_MODEL: 'aura-2', VOICE_SPEAKER: speaker });
    expect(model).toBe(AURA_2_ID);
    expect(input.speaker).toBe(speaker);
  });

  it('uses Aura-2\'s own default speaker when none is configured', async () => {
    const { input } = await modelCall({ VOICE_TTS_MODEL: 'aura-2', VOICE_SPEAKER: undefined });
    expect(input.speaker).toBe('luna');
  });

  it('never sends the model a speaker that belongs to the other model: Aura-1 names to Aura-2 get luna, Aura-2 names to Aura-1 get asteria', async () => {
    captureLogs();
    for (const speaker of ['angus', 'perseus', 'helios', 'stella']) {
      expect((await modelCall({ VOICE_TTS_MODEL: 'aura-2', VOICE_SPEAKER: speaker })).input.speaker, speaker).toBe('luna');
      await reset();
      session = await chatOnce();
    }
    for (const speaker of ['thalia', 'andromeda', 'aura-2-thalia-en']) {
      expect((await modelCall({ VOICE_TTS_MODEL: 'aura-1', VOICE_SPEAKER: speaker })).input.speaker, speaker).toBe('asteria');
      await reset();
      session = await chatOnce();
    }
  });

  it('serves Aura-2 audio the same way, and charges the same character budget', async () => {
    const stub = aiStub(speech);
    const env = auraEnv(stub.ai, { VOICE_TTS_MODEL: 'aura-2' });
    const res = await post(body('Hello there.'), { env });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(MP3));
    expect(await fixedCount(env, globalTtsName())).toBe(12); // 'Hello there.'
  });

  it('keeps the character budget and its refusal the same on Aura-2', async () => {
    const stub = aiStub(speech);
    const env = auraEnv(stub.ai, { VOICE_TTS_MODEL: 'aura-2', VOICE_DAILY_TTS_CHARS: '20' });
    expect((await post(body('Hello there.'), { env })).status).toBe(200); // 12
    const over = await post(body('Hello there.'), { env }); // 12 + 12 is more than 20
    expect(over.status).toBe(503);
    expect(await over.json()).toEqual({ error: 'voice_unavailable', reason: 'budget' });
    expect(stub.run).toHaveBeenCalledTimes(1);
  });

  describe('logging a speaker fallback', () => {
    const fallbackLines = (logs: string[]) => logs.filter((line) => line.includes('"event":"tts_speaker_fallback"'));

    it('logs one tts_speaker_fallback line, with no text, when VOICE_SPEAKER does not fit the model', async () => {
      const logs = captureLogs();
      const ip = randomIp();
      const stub = aiStub(speech);
      const res = await post(body('My card ends in four two four two.'), {
        env: auraEnv(stub.ai, { VOICE_TTS_MODEL: 'aura-2', VOICE_SPEAKER: 'angus' }),
        ip,
      });
      expect(res.status).toBe(200); // the reply is still spoken, in the model's default voice
      expect(stub.run.mock.calls[0]![1].speaker).toBe('luna');
      const lines = fallbackLines(logs);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toEqual({ event: 'tts_speaker_fallback', model: 'aura-2', requested: 'angus', used: 'luna' });
      const all = logs.join('\n');
      expect(all).not.toContain('card ends');
      expect(all).not.toContain(session);
      expect(all).not.toContain(ip);
    });

    it('logs it for Aura-1 too', async () => {
      const logs = captureLogs();
      await post(body('Hello there.'), { env: auraEnv(undefined, { VOICE_TTS_MODEL: 'aura-1', VOICE_SPEAKER: 'thalia' }) });
      expect(fallbackLines(logs).map((line) => JSON.parse(line))).toEqual([
        { event: 'tts_speaker_fallback', model: 'aura-1', requested: 'thalia', used: 'asteria' },
      ]);
    });

    it('cuts a long rejected value so the log line stays small', async () => {
      const logs = captureLogs();
      await post(body('Hello there.'), { env: auraEnv(undefined, { VOICE_SPEAKER: 'x'.repeat(500) }) });
      const parsed = JSON.parse(fallbackLines(logs)[0]!);
      expect(parsed.requested.length).toBeLessThanOrEqual(32);
    });

    it.each([
      ['a speaker that fits Aura-1', { VOICE_TTS_MODEL: 'aura-1', VOICE_SPEAKER: 'angus' }],
      ['a speaker that fits Aura-2', { VOICE_TTS_MODEL: 'aura-2', VOICE_SPEAKER: 'thalia' }],
      ['no speaker at all', { VOICE_TTS_MODEL: 'aura-2', VOICE_SPEAKER: undefined }],
      ['a blank speaker', { VOICE_TTS_MODEL: 'aura-2', VOICE_SPEAKER: '  ' }],
      ['a speaker both models have', { VOICE_TTS_MODEL: 'aura-2', VOICE_SPEAKER: 'asteria' }],
    ])('logs no fallback for %s', async (_label, vars) => {
      const logs = captureLogs();
      await post(body('Hello there.'), { env: auraEnv(undefined, vars) });
      expect(fallbackLines(logs)).toHaveLength(0);
    });

    it('logs nothing for a request refused before the model call', async () => {
      const logs = captureLogs();
      const env = auraEnv(undefined, { VOICE_SPEAKER: 'nobody' });
      await post(body('Hello there.', randomUuid()), { env }); // no chat yet: 403
      await post(body('Hello there.'), { env: auraEnv(undefined, { VOICE_SPEAKER: 'nobody', VOICE_DAILY_TTS_CHARS: '0' }) }); // budget: 503
      expect(fallbackLines(logs)).toHaveLength(0);
    });
  });
});

describe('POST /tts request checks', () => {
  const rejected = async (payload: unknown) => {
    const stub = aiStub(speech);
    const env = auraEnv(stub.ai);
    const res = await post(payload, { env });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request' });
    expect(stub.run).not.toHaveBeenCalled();
    expect(await fixedCount(env, globalTtsName())).toBe(0); // and it cost nothing
  };

  it.each([
    ['not JSON', 'nope{'],
    ['a JSON array', '[]'],
    ['no text', { sessionId: randomUuid() }],
    ['text that is not a string', body(42)],
    ['empty text', body('')],
    ['blank text', body('  \n ')],
    ['text that is only markup', body('<br><i></i>')],
    ['no session id', { text: 'Hello there.' }],
    ['a session id that is not a uuid', body('Hello there.', 'nope')],
    ['a body over 16 KB', JSON.stringify({ ...body('Hello there.'), padding: 'x'.repeat(20_000) })],
  ])('rejects %s with 400 bad_request', async (_label, payload) => {
    await rejected(payload);
  });

  it('rejects 1,001 characters', async () => {
    await rejected(body('a'.repeat(1001)));
  });

  it('accepts exactly 1,000 characters, the longest reply /chat can produce', async () => {
    const stub = aiStub(speech);
    expect((await post(body('a'.repeat(1000)), { env: auraEnv(stub.ai) })).status).toBe(200);
    expect(stub.run.mock.calls[0]![1].text).toHaveLength(1000);
  });

  it('speaks a long reply that was full of characters JSON has to escape', async () => {
    const quoted = '"Hi," she said.\n'.repeat(60); // about 960 characters, many escaped on the wire
    expect((await post(body(quoted), { env: auraEnv() })).status).toBe(200);
  });
});

describe('POST /tts limits', () => {
  it('counts characters against the day: 25,000 by default, then stops with 503 and reason "budget"', async () => {
    const stub = aiStub(speech);
    const env = auraEnv(stub.ai, { VOICE_DAILY_TTS_CHARS: undefined });
    const full = 'a'.repeat(1000);
    for (let i = 0; i < 24; i += 1) {
      expect((await post(body(full), { env, ip: randomIp() })).status, `request ${i + 1}`).toBe(200); // 24,000
    }
    expect(await fixedCount(env, globalTtsName())).toBe(24_000);
    expect((await post(body('a'.repeat(1000) + 'b'), { env, ip: randomIp() })).status).toBe(400); // over the text cap, not the budget
    expect((await post(body('a'.repeat(1000)), { env, ip: randomIp() })).status).toBe(200); // exactly 25,000
    const spent = await post(body('b'), { env, ip: randomIp() });
    expect(spent.status).toBe(503);
    expect(await spent.json()).toEqual({ error: 'voice_unavailable', reason: 'budget' });
    expect(stub.run).toHaveBeenCalledTimes(25);
  });

  it('uses VOICE_DAILY_TTS_CHARS and counts the sanitized length', async () => {
    const stub = aiStub(speech);
    const env = auraEnv(stub.ai, { VOICE_DAILY_TTS_CHARS: '100' });
    expect((await post(body('<b>' + 'a'.repeat(60) + '</b>'), { env })).status).toBe(200);
    expect(await fixedCount(env, globalTtsName())).toBe(60);
    const refused = await post(body('a'.repeat(60)), { env });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: 'voice_unavailable', reason: 'budget' });
    expect((await post(body('a'.repeat(40)), { env })).status).toBe(200);
    expect(stub.run).toHaveBeenCalledTimes(2);
  });

  it('answers 503 with reason "budget" at once when VOICE_DAILY_TTS_CHARS is 0', async () => {
    const stub = aiStub(speech);
    const res = await post(body('Hello.'), { env: auraEnv(stub.ai, { VOICE_DAILY_TTS_CHARS: '0' }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'budget' });
    expect(stub.run).not.toHaveBeenCalled();
  });

  it('allows 30 requests per IP in 10 minutes and answers the 31st with 429', async () => {
    const env = auraEnv();
    const ip = randomIp();
    for (let i = 1; i <= 30; i += 1) expect((await post(body('Hi.'), { env, ip })).status, `request ${i}`).toBe(200);
    const res = await post(body('Hi.'), { env, ip });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await post(body('Hi.'), { env, ip: randomIp() })).status).toBe(200); // another address is unaffected
  });

  it('does not charge the day for a request the IP limit refused', async () => {
    const env = auraEnv();
    const ip = randomIp();
    for (let i = 0; i < 30; i += 1) await post(body('abcd'), { env, ip });
    const before = await fixedCount(env, globalTtsName());
    await post(body('abcd'), { env, ip });
    expect(await fixedCount(env, globalTtsName())).toBe(before);
  });
});

describe('POST /tts when Workers AI misbehaves', () => {
  it('answers 503 with reason "server" when the call throws, and does not retry', async () => {
    const stub = aiStub(() => {
      throw new Error('boom: private words');
    });
    captureLogs();
    const res = await post(body('Hello there.'), { env: auraEnv(stub.ai) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
    expect(stub.run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an error status', () => new Response('nope', { status: 500 })],
    ['no body', () => new Response(null, { status: 200 })],
    ['something that is not a response', () => ({ audio: 'abc' })],
  ])('answers 503 with reason "server" when the raw response is %s', async (_label, make) => {
    captureLogs();
    const res = await post(body('Hello there.'), { env: auraEnv(aiStub(make).ai) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
  });

  it('gives up when the model takes too long, and aborts its request', async () => {
    let signal: AbortSignal | undefined;
    const stub = aiStub((_model, _input, options) => {
      signal = options?.signal as AbortSignal;
      return new Promise(() => undefined);
    });
    captureLogs();
    const started = performance.now();
    const res = await post(body('Hello there.'), { env: auraEnv(stub.ai) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(signal?.aborted).toBe(true);
  });

  it('answers 503 with reason "server", with no model call, when the limiter is down', async () => {
    const logs = captureLogs();
    const stub = aiStub(speech);
    const failing = {
      getByName: () => ({
        hit: () => Promise.reject(new Error('do exploded')),
        peek: () => Promise.reject(new Error('do exploded')),
      }),
    };
    const res = await post(body('Hello there.'), { env: auraEnv(stub.ai, { LIMITER: failing }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
    expect(stub.run).not.toHaveBeenCalled();
    expect(logs.some((line) => line.includes('"event":"limiter_error"'))).toBe(true);
    expect(logs.join('\n')).not.toMatch(/exploded/);
  });
});

describe('POST /tts logging', () => {
  it('logs one tts line with counters only, never the text', async () => {
    const logs = captureLogs();
    const sessionId = session; // a session that has chatted
    const ip = randomIp();
    const res = await post(body('My card ends in four two four two.', sessionId), { env: auraEnv(), ip });
    expect(res.status).toBe(200);
    const lines = logs.filter((line) => line.includes('"event":"tts"'));
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(Object.keys(parsed).sort()).toEqual(['chars', 'event', 'ms', 'provider', 'status']);
    expect(parsed).toMatchObject({ event: 'tts', provider: 'aura', status: 200, chars: 34 });
    const all = logs.join('\n');
    expect(all).not.toContain('card ends');
    expect(all).not.toContain(sessionId);
    expect(all).not.toContain(ip);
  });

  it('logs error names, not messages, when the model fails', async () => {
    const logs = captureLogs();
    const stub = aiStub(() => {
      throw new Error('could not say: My card ends in four two');
    });
    await post(body('My card ends in four two.'), { env: auraEnv(stub.ai) });
    expect(logs.join('\n')).not.toContain('card ends');
    expect(logs.some((line) => line.includes('"event":"tts_error"') && line.includes('"error":"Error"'))).toBe(true);
    const final = JSON.parse(logs.filter((line) => line.includes('"event":"tts"')).at(-1)!);
    expect(final).toMatchObject({ status: 503, chars: 25 });
  });
});
