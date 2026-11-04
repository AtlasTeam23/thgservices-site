import { createExecutionContext, reset, runInDurableObject, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_ATTEMPT_TIMEOUT_MS } from '../src/ai';
import { ENDED } from '../src/copy';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import { etDay, globalVoiceName, sessionName, sessionVoiceName } from '../src/limits';
import { aiStub, call, randomIp, randomUuid, testEnv, type AiHandler } from './helpers';

const TEST_TURNSTILE_SECRET = '1x0000000000000000000000000000000AA'; // Cloudflare's published always-pass test secret
const MODEL = '@cf/openai/whisper-large-v3-turbo';
const AUDIO_MAX = 1_048_576;

/** Bytes that cover every value, so a bad base64 conversion shows up. */
const bytesOf = (length: number): Uint8Array => Uint8Array.from({ length }, (_, i) => (i * 31 + 7) % 256);
const clip = (length = 2048, type = 'audio/webm;codecs=opus', name = 'clip.webm') =>
  new File([bytesOf(length)], name, { type });

interface FormOptions {
  audio?: File | string | null;
  sessionId?: string | null;
  durationMs?: string | number;
  turnstileToken?: string;
}

const form = ({ audio = clip(), sessionId = randomUuid(), durationMs, turnstileToken }: FormOptions = {}): FormData => {
  const data = new FormData();
  if (audio !== null) data.append('audio', audio);
  if (sessionId !== null) data.append('sessionId', sessionId);
  if (durationMs !== undefined) data.append('durationMs', String(durationMs));
  if (turnstileToken !== undefined) data.append('turnstileToken', turnstileToken);
  return data;
};

// No retry delay and a short timeout, so the failure paths do not wait.
const app = createApp({ voice: { retryDelayMs: 0, timeoutMs: 40 } });

const post = (body: FormData | string, options: Parameters<typeof call>[1] = {}) =>
  call('/stt', { body, app, ...options });

/** A recognizer that always hears `text`. */
const hears = (text: string, extra: Record<string, unknown> = {}) => aiStub(() => ({ text, ...extra }));

const voiceEnv = (ai: Env['AI'], extra: Record<string, unknown> = {}) => testEnv({ AI: ai, ...extra });

const decode = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);

/** A recognizer that hears `text` and says the recording lasted `seconds` (whatever that value is). */
const reports = (seconds: unknown, text = 'hi') => hears(text, { transcription_info: { duration: seconds } });

/** Reads a fixed counter's value without touching it (0 before its first hit). */
const fixedCount = (env: Env, name: string): Promise<number> =>
  runInDurableObject(env.LIMITER.getByName(name), (_instance, ctx) => {
    try {
      return ctx.storage.sql.exec<{ count: number }>('SELECT count FROM counter WHERE id = 0').toArray()[0]?.count ?? 0;
    } catch {
      return 0; // the tables are created by the first hit
    }
  });

/** Seconds counted so far today against the daily voice budget. */
const dailyUsed = (env: Env): Promise<number> => fixedCount(env, globalVoiceName());
const sessionUsed = (env: Env, sessionId: string): Promise<number> => fixedCount(env, sessionVoiceName(sessionId));
/** Messages counted so far against the session's 40-message cap. */
const messagesUsed = (env: Env, sessionId: string): Promise<number> =>
  runInDurableObject(env.LIMITER.getByName(sessionName(sessionId)), (_instance, ctx) => {
    try {
      return ctx.storage.sql.exec<{ c: number }>('SELECT COUNT(*) AS c FROM hits').one().c;
    } catch {
      return 0;
    }
  });

const captureLogs = () => {
  const lines: string[] = [];
  const grab = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  vi.spyOn(console, 'log').mockImplementation(grab);
  vi.spyOn(console, 'error').mockImplementation(grab);
  vi.spyOn(console, 'warn').mockImplementation(grab);
  return lines;
};

beforeEach(async () => {
  await reset(); // fresh Durable Object state, including today's global voice counter
});
afterEach(() => vi.restoreAllMocks());

describe('POST /stt happy path', () => {
  it('runs Whisper on the upload and returns the transcript, with the client duration', async () => {
    const { ai, run } = hears('what do you do');
    const res = await post(form({ durationMs: 4200 }), { env: voiceEnv(ai) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://thgservices.io');
    expect(await res.json()).toEqual({ text: 'what do you do', durationMs: 4200 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('sends the documented input shape: base64 audio, transcribe, English, voice-activity filter on', async () => {
    const { ai, run } = hears('hello');
    await post(form({ audio: clip(3000) }), { env: voiceEnv(ai) });
    const [model, input] = run.mock.calls[0]!;
    expect(model).toBe(MODEL);
    expect(Object.keys(input).sort()).toEqual(['audio', 'language', 'task', 'vad_filter']);
    expect(input).toMatchObject({ task: 'transcribe', language: 'en', vad_filter: true });
    expect(typeof input.audio).toBe('string');
    expect(input.audio).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it('base64-encodes the exact bytes uploaded, including a clip big enough to need chunking', async () => {
    const { ai, run } = hears('hello');
    await post(form({ audio: clip(300_000) }), { env: voiceEnv(ai) });
    expect(Array.from(decode(run.mock.calls[0]![1].audio))).toEqual(Array.from(bytesOf(300_000)));
  });

  it('round-trips a full 1 MiB recording through the conversion', async () => {
    const { ai, run } = hears('hello');
    const res = await post(form({ audio: clip(AUDIO_MAX) }), { env: voiceEnv(ai) });
    expect(res.status).toBe(200);
    expect(sameBytes(decode(run.mock.calls[0]![1].audio), bytesOf(AUDIO_MAX))).toBe(true);
  });

  it.each([
    ['audio/webm', 'a.webm'],
    ['audio/webm;codecs=opus', 'a.webm'],
    ['audio/mp4', 'a.m4a'],
    ['audio/ogg;codecs=opus', 'a.ogg'],
    ['audio/wav', 'a.wav'],
    ['Audio/WebM; codecs=opus', 'a.webm'],
  ])('accepts %s', async (type, name) => {
    const { ai } = hears('ok');
    const res = await post(form({ audio: clip(512, type, name) }), { env: voiceEnv(ai) });
    expect(res.status, type).toBe(200);
  });

  it('trims the transcript, strips markup and control characters, and puts it on one line', async () => {
    const { ai } = hears('  <b>what</b> do\u0000 you\n do <script>x</script> \n');
    const res = await post(form(), { env: voiceEnv(ai) });
    expect(await res.json()).toMatchObject({ text: 'what do you do x' });
  });

  it('cuts a transcript to 1,000 characters', async () => {
    const { ai } = hears('word '.repeat(400));
    const body = (await (await post(form(), { env: voiceEnv(ai) })).json()) as { text: string };
    expect(body.text.length).toBeLessThanOrEqual(1000);
    expect(body.text.startsWith('word word')).toBe(true);
    expect(body.text).toBe(body.text.trim());
  });

  it.each([['an empty string', ''], ['only blanks', ' \n\t '], ['only markup', '<br><i></i>']])(
    'answers { text: "" } for a transcript that is %s',
    async (_label, text) => {
      const { ai } = hears(text);
      const res = await post(form({ durationMs: 2000 }), { env: voiceEnv(ai) });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ text: '' });
    },
  );

  it('still counts the audio when the transcript is empty (the model ran)', async () => {
    const env = voiceEnv(hears('').ai);
    await post(form({ durationMs: 3000 }), { env });
    expect(await dailyUsed(env)).toBe(3);
  });

  describe('durationMs in the answer', () => {
    it("is the client's value, capped at 20,000", async () => {
      const env = voiceEnv(hears('hi').ai);
      expect(await (await post(form({ durationMs: 1234 }), { env })).json()).toMatchObject({ durationMs: 1234 });
      expect(await (await post(form({ durationMs: 99_999 }), { env })).json()).toMatchObject({ durationMs: 20_000 });
    });

    it("falls back to the model's own measurement when the client sent none", async () => {
      const env = voiceEnv(hears('hi', { transcription_info: { duration: 4.2 } }).ai);
      expect(await (await post(form(), { env })).json()).toMatchObject({ durationMs: 4200 });
    });

    it('falls back to the 10-second default when nobody measured', async () => {
      const env = voiceEnv(hears('hi').ai);
      expect(await (await post(form(), { env })).json()).toMatchObject({ durationMs: 10_000 });
    });
  });
});

describe('POST /stt request checks', () => {
  const rejected = async (body: FormData | string, error = 'bad_audio', options: Parameters<typeof call>[1] = {}) => {
    const stub = hears('should not run');
    const res = await post(body, { env: voiceEnv(stub.ai), ...options });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(stub.run).not.toHaveBeenCalled();
  };

  it('rejects a 2 MB upload as bad_audio without running the model', async () => {
    await rejected(form({ audio: clip(2 * AUDIO_MAX) }));
  });

  it('accepts exactly 1,048,576 bytes and rejects one more', async () => {
    const ok = hears('big');
    expect((await post(form({ audio: clip(AUDIO_MAX) }), { env: voiceEnv(ok.ai) })).status).toBe(200);
    await rejected(form({ audio: clip(AUDIO_MAX + 1) }));
  });

  it('rejects a text/plain upload', async () => {
    await rejected(form({ audio: clip(512, 'text/plain', 'a.txt') }));
  });

  it.each([
    ['an unlabelled file', ''],
    ['application/octet-stream', 'application/octet-stream'],
    ['video/webm', 'video/webm'],
    ['audio/mpeg', 'audio/mpeg'],
    ['text/html', 'text/html'],
  ])('rejects %s', async (_label, type) => {
    await rejected(form({ audio: clip(512, type) }));
  });

  it('rejects an empty file', async () => {
    await rejected(form({ audio: clip(0) }));
  });

  it('rejects a missing audio part, and an audio field that is plain text rather than a file', async () => {
    await rejected(form({ audio: null }));
    await rejected(form({ audio: 'just words' }));
  });

  it('rejects a body that is not multipart', async () => {
    await rejected(JSON.stringify({ sessionId: randomUuid() }));
    await rejected('not a form at all', 'bad_audio', { headers: { 'Content-Type': 'multipart/form-data; boundary=zzz' } });
  });

  describe('multipart edge cases', () => {
    const boundary = 'testboundary123';
    const raw = (parts: string[]) => parts.map((part) => `--${boundary}\r\n${part}\r\n`).join('') + `--${boundary}--\r\n`;
    const asMultipart = { headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
    const sessionPart = () => `Content-Disposition: form-data; name="sessionId"\r\n\r\n${randomUuid()}`;

    it('uses the first audio part when a request carries two, and ignores the second', async () => {
      const stub = hears('first');
      const data = form({ audio: clip(1000, 'audio/webm', 'a.webm') });
      data.append('audio', new File([new Uint8Array(500).fill(9)], 'b.webm', { type: 'audio/webm' }));
      const res = await post(data, { env: voiceEnv(stub.ai) });
      expect(res.status).toBe(200);
      expect(sameBytes(decode(stub.run.mock.calls[0]![1].audio), bytesOf(1000))).toBe(true);
    });

    it('judges only the first audio part: a bad first part is refused even when a good one follows', async () => {
      const stub = hears('no');
      const data = form({ audio: clip(512, 'text/plain', 'a.txt') });
      data.append('audio', clip(512));
      const res = await post(data, { env: voiceEnv(stub.ai) });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_audio' });
      expect(stub.run).not.toHaveBeenCalled();
    });

    it('takes a hand-built multipart body with a filename (so the next case differs only in the filename)', async () => {
      const body = raw([
        'Content-Disposition: form-data; name="audio"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\nabcdefgh',
        sessionPart(),
      ]);
      expect((await post(body, { env: voiceEnv(hears('ok').ai), ...asMultipart })).status).toBe(200);
    });

    it('refuses an audio part with no filename: it reaches the Worker as plain text, not as a file', async () => {
      const stub = hears('no');
      const body = raw([
        'Content-Disposition: form-data; name="audio"\r\nContent-Type: audio/webm\r\n\r\nabcdefgh',
        sessionPart(),
      ]);
      const res = await post(body, { env: voiceEnv(stub.ai), ...asMultipart });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_audio' });
      expect(stub.run).not.toHaveBeenCalled();
    });
  });

  it.each([['a missing id', null], ['an id that is not a uuid', 'nope']])(
    'rejects %s as bad_request, like /chat',
    async (_label, sessionId) => {
      await rejected(form({ sessionId }), 'bad_request');
    },
  );

  it('refuses a body with a declared length far over the cap before reading it', async () => {
    const stub = hears('no');
    const request = new Request('https://concierge.test/stt', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=zzz', Origin: 'https://thgservices.io', 'CF-Connecting-IP': randomIp() },
      body: 'x',
    });
    // The runtime fixes Content-Length from the body, so wrap the request to declare a bigger one.
    const wrapped = new Proxy(request, {
      get: (target, prop) => {
        if (prop === 'headers') {
          const headers = new Headers(target.headers);
          headers.set('Content-Length', String(50 * AUDIO_MAX));
          return headers;
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(wrapped, voiceEnv(stub.ai), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_audio' });
    expect(request.bodyUsed).toBe(false);
  });

  it('stops reading a huge body that declares no length soon after the cap', async () => {
    const stub = hears('no');
    let pulled = 0;
    const CHUNK = 64 * 1024;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (pulled >= 800) return controller.close(); // 50 MB on offer
          pulled += 1;
          controller.enqueue(new Uint8Array(CHUNK).fill(1));
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request('https://concierge.test/stt', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=zzz', 'CF-Connecting-IP': randomIp() },
      body,
      // @ts-expect-error duplex is required by some runtimes for streamed bodies
      duplex: 'half',
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(request, voiceEnv(stub.ai), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    expect(pulled).toBeLessThan(40); // the cap is about 17 chunks of 64 KB
    expect(stub.run).not.toHaveBeenCalled();
  });

  it('does not use up any allowance on a rejected request', async () => {
    const env = voiceEnv(hears('x').ai);
    const sessionId = randomUuid();
    await post(form({ sessionId, audio: clip(512, 'text/plain') }), { env });
    await post(form({ sessionId, audio: clip(0) }), { env });
    await post(form({ sessionId, audio: clip(2 * AUDIO_MAX) }), { env });
    expect(await messagesUsed(env, sessionId)).toBe(0);
    expect(await sessionUsed(env, sessionId)).toBe(0);
    expect(await dailyUsed(env)).toBe(0);
  });

  it('answers 405 to a GET, and honors the same origin rules as /chat', async () => {
    const get = await call('/stt', { method: 'GET', app });
    expect(get.status).toBe(405);
    expect(get.headers.get('Allow')).toBe('POST, OPTIONS');
    const denied = await post(form(), { env: voiceEnv(hears('x').ai), origin: 'https://evil.example' });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'origin_not_allowed' });
    const noOrigin = await post(form(), { env: voiceEnv(hears('x').ai), origin: null });
    expect(noOrigin.status).toBe(200);
  });

  it('answers the CORS preflight', async () => {
    const res = await call('/stt', { method: 'OPTIONS', app, headers: { 'Access-Control-Request-Method': 'POST' } });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://thgservices.io');
  });
});

describe('POST /stt when voice is unavailable', () => {
  it('answers 503 with reason "server" when there is no AI binding, and counts nothing', async () => {
    const env = testEnv({ AI: undefined });
    const sessionId = randomUuid();
    const res = await post(form({ sessionId }), { env });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
    expect(await messagesUsed(env, sessionId)).toBe(0);
  });

  it.each([['VOICE_DAILY_STT_SECONDS'], ['VOICE_SESSION_SECONDS']])(
    'answers 503 with reason "budget" when %s is 0',
    async (key) => {
      const stub = hears('x');
      const res = await post(form(), { env: voiceEnv(stub.ai, { [key]: '0' }) });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'budget' });
      expect(stub.run).not.toHaveBeenCalled();
    },
  );
});

describe('POST /stt rate limits', () => {
  const chatBody = (sessionId: string) => ({ sessionId, messages: [{ role: 'user', content: 'hello' }] });

  it('allows 30 recordings per IP in 10 minutes and answers the 31st with 429', async () => {
    const env = voiceEnv(hears('hi').ai);
    const ip = randomIp();
    for (let i = 1; i <= 30; i += 1) {
      const res = await post(form({ durationMs: 1000 }), { env, ip }); // a fresh session each time
      expect(res.status, `request ${i}`).toBe(200);
    }
    const res = await post(form({ durationMs: 1000 }), { env, ip });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('keeps the address counter for speech apart from the one for chat, in both directions', async () => {
    const env = voiceEnv(hears('hi').ai);
    const ip = randomIp();
    for (let i = 0; i < 20; i += 1) {
      expect((await call('/chat', { body: chatBody(randomUuid()), env, ip })).status).toBe(200);
    }
    expect((await call('/chat', { body: chatBody(randomUuid()), env, ip })).status).toBe(429);
    expect((await post(form({ durationMs: 1000 }), { env, ip })).status).toBe(200); // chat is spent, speech is not

    const other = randomIp();
    for (let i = 0; i < 25; i += 1) expect((await post(form({ durationMs: 1000 }), { env, ip: other })).status).toBe(200);
    for (let i = 0; i < 20; i += 1) {
      expect((await call('/chat', { body: chatBody(randomUuid()), env, ip: other })).status, `chat ${i + 1}`).toBe(200);
    }
  });

  it('does not count a recording as a chat message', async () => {
    const env = voiceEnv(hears('hi').ai);
    const sessionId = randomUuid();
    for (let i = 0; i < 3; i += 1) expect((await post(form({ sessionId, durationMs: 1000 }), { env })).status).toBe(200);
    expect(await messagesUsed(env, sessionId)).toBe(0);
  });

  it('refuses with 429 once the session already has 40 chat messages, so nothing is transcribed only for /chat to refuse it', async () => {
    const stub = hears('hi');
    const env = voiceEnv(stub.ai);
    const sessionId = randomUuid();
    for (let i = 0; i < 39; i += 1) {
      expect((await call('/chat', { body: chatBody(sessionId), env })).status, `chat ${i + 1}`).toBe(200);
    }
    expect((await post(form({ sessionId, durationMs: 1000 }), { env })).status).toBe(200); // 39 messages: still room for one more
    expect((await call('/chat', { body: chatBody(sessionId), env })).status).toBe(200); // the 40th
    expect(stub.run).toHaveBeenCalledTimes(1);

    const res = await post(form({ sessionId, durationMs: 1000 }), { env });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(stub.run).toHaveBeenCalledTimes(1); // no model call
    expect(await messagesUsed(env, sessionId)).toBe(40); // and it added nothing
  });

  it('does not use up the address\'s allowance, the session\'s seconds or the day\'s seconds on that 429', async () => {
    const stub = hears('hi');
    const env = voiceEnv(stub.ai);
    const sessionId = randomUuid();
    const ip = randomIp();
    for (let i = 0; i < 40; i += 1) await call('/chat', { body: chatBody(sessionId), env });
    for (let i = 0; i < 5; i += 1) expect((await post(form({ sessionId, durationMs: 9000 }), { env, ip })).status).toBe(429);
    expect(await sessionUsed(env, sessionId)).toBe(0);
    expect(await dailyUsed(env)).toBe(0);
    // All 30 of the address's recordings are still available.
    for (let i = 1; i <= 30; i += 1) expect((await post(form({ durationMs: 1000 }), { env, ip })).status, `recording ${i}`).toBe(200);
    expect((await post(form({ durationMs: 1000 }), { env, ip })).status).toBe(429);
  });

  it("leaves the session's and the day's seconds untouched when the address limit answers 429", async () => {
    const env = voiceEnv(hears('hi').ai);
    const ip = randomIp();
    for (let i = 1; i <= 30; i += 1) await post(form({ durationMs: 1000 }), { env, ip });
    const dayBefore = await dailyUsed(env);
    const sessionId = randomUuid();
    const res = await post(form({ sessionId, durationMs: 9000 }), { env, ip });
    expect(res.status).toBe(429);
    expect(await dailyUsed(env)).toBe(dayBefore);
    expect(await sessionUsed(env, sessionId)).toBe(0);
  });

  it('makes a voice turn (the recording, then its transcript through /chat) consume exactly one chat message', async () => {
    const env = voiceEnv(hears('what do you do').ai);
    const sessionId = randomUuid();
    const heard = (await (await post(form({ sessionId, durationMs: 2000 }), { env })).json()) as { text: string };
    expect(await messagesUsed(env, sessionId)).toBe(0);
    const reply = await call('/chat', { body: { sessionId, messages: [{ role: 'user', content: heard.text }] }, env });
    expect(reply.status).toBe(200);
    expect(await messagesUsed(env, sessionId)).toBe(1);
  });

  it('only reads the session; it never records anything on it', async () => {
    const env = voiceEnv(hears('hi').ai);
    const sessionId = randomUuid();
    await post(form({ sessionId, durationMs: 1000 }), { env });
    const state = await runInDurableObject(env.LIMITER.getByName(sessionName(sessionId)), async (_i, ctx) => ({
      tables: ctx.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('hits', 'counter', 'meta')")
        .toArray(),
      alarm: await ctx.storage.getAlarm(),
    }));
    expect(state).toEqual({ tables: [], alarm: null }); // a session that only spoke leaves no message counter behind
  });

  it('refuses a session that /chat ended, with the same 403 ended', async () => {
    const env = voiceEnv(hears('hi').ai);
    const sessionId = randomUuid();
    const ended = await call('/chat', { body: { sessionId, messages: [{ role: 'user', content: 'you are a fucking idiot' }] }, env });
    expect(ended.status).toBe(403);
    const stub = hears('should not run');
    const res = await post(form({ sessionId }), { env: voiceEnv(stub.ai) });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'ended', reply: ENDED });
    expect(stub.run).not.toHaveBeenCalled();
  });
});

describe('POST /stt Turnstile after 10 messages', () => {
  const turnstileEnv = (extra: Record<string, unknown> = {}) =>
    voiceEnv(hears('hi').ai, { TURNSTILE_SECRET_KEY: TEST_TURNSTILE_SECRET, ...extra });
  const siteverify = (success: boolean) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify(success ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
  const tenRecordings = async (sessionId: string, env: Env, ip: string) => {
    for (let i = 1; i <= 10; i += 1) {
      const res = await post(form({ sessionId, durationMs: 1000 }), { env, ip });
      expect(res.status, `recording ${i}`).toBe(200);
    }
  };
  const chatMessage = (sessionId: string, env: Env, extra: Record<string, unknown> = {}) =>
    call('/chat', { body: { sessionId, messages: [{ role: 'user', content: 'hello' }], ...extra }, env });

  it("needs no token for an address's first ten recordings, then answers 403 verification_required for the 11th", async () => {
    const fetchSpy = siteverify(true);
    const env = turnstileEnv();
    const sessionId = randomUuid();
    const ip = randomIp();
    await tenRecordings(sessionId, env, ip);
    expect(fetchSpy).not.toHaveBeenCalled();
    const res = await post(form({ sessionId }), { env, ip });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'verification_required' });
  });

  it('accepts the 11th with a token that verifies, sending Cloudflare the secret, token and caller IP', async () => {
    const fetchSpy = siteverify(true);
    const env = turnstileEnv();
    const sessionId = randomUuid();
    const ip = randomIp();
    await tenRecordings(sessionId, env, ip);
    const res = await post(form({ sessionId, durationMs: 1000, turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' }), { env, ip });
    expect(res.status).toBe(200);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const sent = init?.body as URLSearchParams;
    expect(sent.get('secret')).toBe(TEST_TURNSTILE_SECRET);
    expect(sent.get('response')).toBe('XXXX.DUMMY.TOKEN.XXXX');
    expect(sent.get('remoteip')).toBe(ip);
  });

  it('answers 403 when the token does not verify, and the failed check costs no speech budget', async () => {
    siteverify(false);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = turnstileEnv();
    const sessionId = randomUuid();
    const ip = randomIp();
    await tenRecordings(sessionId, env, ip);
    const res = await post(form({ sessionId, durationMs: 5000, turnstileToken: 'bad' }), { env, ip });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'verification_required' });
    expect(await dailyUsed(env)).toBe(10); // the ten earlier 1-second recordings, not the refused 5-second one
    expect(await sessionUsed(env, sessionId)).toBe(10);
  });

  it("asks for a token on an address's 11th recording even when every session id is new", async () => {
    siteverify(true);
    const env = turnstileEnv();
    const ip = randomIp();
    for (let i = 1; i <= 10; i += 1) expect((await post(form({ durationMs: 1000 }), { env, ip })).status).toBe(200);
    const res = await post(form({ durationMs: 1000 }), { env, ip });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'verification_required' });
  });

  it('does not ask a session that only speaks for a token because of its own recordings, from different addresses', async () => {
    const fetchSpy = siteverify(true);
    const env = turnstileEnv();
    const sessionId = randomUuid();
    for (let i = 1; i <= 12; i += 1) {
      expect((await post(form({ sessionId, durationMs: 1000 }), { env })).status, `recording ${i}`).toBe(200); // a new address each time
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("also asks once the session's chat messages are over ten, reading that count without adding to it", async () => {
    const fetchSpy = siteverify(true);
    const env = turnstileEnv();
    const sessionId = randomUuid();
    for (let i = 1; i <= 10; i += 1) expect((await chatMessage(sessionId, env)).status, `chat ${i}`).toBe(200);
    // Ten chat messages: a recording is still fine without a token.
    expect((await post(form({ sessionId, durationMs: 1000 }), { env })).status).toBe(200);
    expect(await messagesUsed(env, sessionId)).toBe(10);
    // The 11th chat message needs a token itself; once it has one, the count is 11.
    expect((await chatMessage(sessionId, env, { turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' })).status).toBe(200);
    fetchSpy.mockClear();
    const without = await post(form({ sessionId, durationMs: 1000 }), { env });
    expect(without.status).toBe(403);
    expect(await without.json()).toEqual({ error: 'verification_required' });
    expect(await messagesUsed(env, sessionId)).toBe(11);
    const withToken = await post(form({ sessionId, durationMs: 1000, turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' }), { env });
    expect(withToken.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await messagesUsed(env, sessionId)).toBe(11); // the recordings added nothing
  });

  it('skips verification when no Turnstile secret is configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = voiceEnv(hears('hi').ai);
    const sessionId = randomUuid();
    const ip = randomIp();
    await tenRecordings(sessionId, env, ip);
    expect((await post(form({ sessionId, durationMs: 1000 }), { env, ip })).status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('POST /stt audio budgets', () => {
  describe('charged after the call: the length the model measured', () => {
    it('charges a 1 MiB upload that claims durationMs=1 the 1,380 seconds the model reports', async () => {
      const env = voiceEnv(reports(1380).ai);
      const sessionId = randomUuid();
      const res = await post(form({ sessionId, audio: clip(AUDIO_MAX, 'audio/wav', 'a.wav'), durationMs: 1 }), { env });
      expect(res.status).toBe(200);
      expect(await dailyUsed(env)).toBe(1380);
      expect(await sessionUsed(env, sessionId)).toBe(1380);
    });

    it.each([
      [4.2, 5],
      [5, 5],
      [5.01, 6],
      [0.2, 1], // at least a second
      [60, 60], // not held to the 20 second limit that applies to the client's figure
    ])('charges a measured %s seconds as %i', async (measured, charged) => {
      const env = voiceEnv(reports(measured).ai);
      const sessionId = randomUuid();
      await post(form({ sessionId, audio: clip(160_000, 'audio/wav', 'a.wav'), durationMs: 5000 }), { env });
      expect(await dailyUsed(env)).toBe(charged);
      expect(await sessionUsed(env, sessionId)).toBe(charged);
    });

    it.each([[0], [-3], [Number.NaN], [Number.POSITIVE_INFINITY], ['12'], [null], [undefined]])(
      'ignores a measurement of %s and charges the estimate instead',
      async (measured) => {
        const env = voiceEnv(reports(measured).ai);
        await post(form({ durationMs: 4000 }), { env });
        expect(await dailyUsed(env)).toBe(4);
      },
    );

    it("counts a session that a long recording took past its cap as over it, so its next recording is refused", async () => {
      const stub = reports(1380);
      const env = voiceEnv(stub.ai);
      const sessionId = randomUuid();
      expect((await post(form({ sessionId, durationMs: 1 }), { env })).status).toBe(200); // 0 of 180 used: allowed
      const next = await post(form({ sessionId, durationMs: 1 }), { env });
      expect(next.status).toBe(503);
      expect(await next.json()).toEqual({ error: 'voice_unavailable', reason: 'budget' });
      expect(stub.run).toHaveBeenCalledTimes(1);
      expect(await dailyUsed(env)).toBe(1380); // the refused one cost nothing
    });
  });

  describe('when the model reports no length: the larger of the client figure and bytes / 16,000', () => {
    it.each([
      ['4200', 5],
      ['4000', 4],
      ['4000.1', 5],
      ['1', 1],
      ['20000', 20],
      ['25000', 20], // over the limit counts as the 20-second maximum
      [undefined, 10], // nothing sent: assume 10 seconds
      ['abc', 10],
      ['-5', 10],
      ['0', 10],
      ['', 10],
    ])('counts durationMs %j as %i seconds', async (durationMs, seconds) => {
      const env = voiceEnv(hears('hi').ai);
      const sessionId = randomUuid();
      await post(form({ sessionId, durationMs }), { env });
      expect(await dailyUsed(env)).toBe(seconds);
      expect(await sessionUsed(env, sessionId)).toBe(seconds);
    });

    it('uses bytes / 16,000 when the upload says more than the client did', async () => {
      const env = voiceEnv(hears('hi').ai);
      await post(form({ audio: clip(320_000, 'audio/wav', 'a.wav'), durationMs: 1000 }), { env });
      expect(await dailyUsed(env)).toBe(20); // 320,000 / 16,000
    });

    it('uses the client figure when that is the larger', async () => {
      const env = voiceEnv(hears('hi').ai);
      await post(form({ audio: clip(32_000, 'audio/wav', 'a.wav'), durationMs: 5000 }), { env });
      expect(await dailyUsed(env)).toBe(5);
    });
  });

  describe('a call that fails twice is charged the same estimate (the neurons were likely spent)', () => {
    const failing = () =>
      aiStub(() => {
        throw new Error('boom');
      });

    it("charges the client's figure for a small upload", async () => {
      captureLogs();
      const env = voiceEnv(failing().ai);
      const sessionId = randomUuid();
      const res = await post(form({ sessionId, durationMs: 3000 }), { env });
      expect(res.status).toBe(503);
      expect(await dailyUsed(env)).toBe(3);
      expect(await sessionUsed(env, sessionId)).toBe(3);
    });

    it('charges bytes / 16,000 for a big upload with a small claim', async () => {
      captureLogs();
      const env = voiceEnv(failing().ai);
      await post(form({ audio: clip(160_000, 'audio/wav', 'a.wav'), durationMs: 2000 }), { env });
      expect(await dailyUsed(env)).toBe(10);
    });

    it('charges 10 seconds when nothing was claimed and the upload is small', async () => {
      captureLogs();
      const env = voiceEnv(failing().ai);
      await post(form(), { env });
      expect(await dailyUsed(env)).toBe(10);
    });

    it('charges a 1 MiB upload 66 seconds (1,048,576 / 16,000, rounded up)', async () => {
      captureLogs();
      const env = voiceEnv(failing().ai);
      await post(form({ audio: clip(AUDIO_MAX), durationMs: 1 }), { env });
      expect(await dailyUsed(env)).toBe(66);
    });
  });

  describe('checked before the call', () => {
    it('refuses a session already at VOICE_SESSION_SECONDS before any model call, and leaves the day alone', async () => {
      const stub = hears('hi');
      const env = voiceEnv(stub.ai, { VOICE_SESSION_SECONDS: '10' });
      const sessionId = randomUuid();
      expect((await post(form({ sessionId, durationMs: 10_000 }), { env })).status).toBe(200); // now exactly at the cap
      const over = await post(form({ sessionId, durationMs: 1000 }), { env });
      expect(over.status).toBe(503);
      expect(await over.json()).toEqual({ error: 'voice_unavailable', reason: 'budget' });
      expect(stub.run).toHaveBeenCalledTimes(1);
      expect(await dailyUsed(env)).toBe(10);
    });

    it('refuses once the day is at VOICE_DAILY_STT_SECONDS, whoever asks, before any model call', async () => {
      const stub = hears('hi');
      const env = voiceEnv(stub.ai, { VOICE_DAILY_STT_SECONDS: '10' });
      expect((await post(form({ durationMs: 10_000 }), { env })).status).toBe(200);
      const over = await post(form({ durationMs: 1000 }), { env });
      expect(over.status).toBe(503);
      expect(await over.json()).toEqual({ error: 'voice_unavailable', reason: 'budget' });
      expect(stub.run).toHaveBeenCalledTimes(1);
    });

    it('lets a recording through while the counter is still under its cap, records what it really cost, then refuses', async () => {
      const stub = hears('hi');
      const env = voiceEnv(stub.ai, { VOICE_SESSION_SECONDS: '10' });
      const sessionId = randomUuid();
      expect((await post(form({ sessionId, durationMs: 4000 }), { env })).status).toBe(200); // 4
      expect((await post(form({ sessionId, durationMs: 4000 }), { env })).status).toBe(200); // 8
      expect((await post(form({ sessionId, durationMs: 4000 }), { env })).status).toBe(200); // 8 is under 10: allowed, 12 recorded
      expect(await sessionUsed(env, sessionId)).toBe(12);
      const over = await post(form({ sessionId, durationMs: 4000 }), { env });
      expect(over.status).toBe(503);
      expect(stub.run).toHaveBeenCalledTimes(3);
      expect(await dailyUsed(env)).toBe(12);
    });

    it('stops all visitors at the default 9,000 seconds a day (150 minutes)', async () => {
      const stub = reports(1500);
      const env = voiceEnv(stub.ai, { VOICE_DAILY_STT_SECONDS: undefined, VOICE_SESSION_SECONDS: undefined });
      for (let i = 1; i <= 6; i += 1) {
        expect((await post(form({ durationMs: 1000 }), { env })).status, `request ${i}`).toBe(200); // a new session each time
      }
      expect(await dailyUsed(env)).toBe(9000);
      const over = await post(form({ durationMs: 1000 }), { env });
      expect(over.status).toBe(503);
      expect(await over.json()).toEqual({ error: 'voice_unavailable', reason: 'budget' });
      expect(stub.run).toHaveBeenCalledTimes(6);
    });

    it('defaults to 3 minutes a session', async () => {
      const stub = hears('hi');
      const env = voiceEnv(stub.ai, { VOICE_DAILY_STT_SECONDS: undefined, VOICE_SESSION_SECONDS: undefined });
      const sessionId = randomUuid();
      for (let i = 0; i < 9; i += 1) expect((await post(form({ sessionId, durationMs: 20_000 }), { env })).status).toBe(200); // 180 s
      expect((await post(form({ sessionId, durationMs: 1000 }), { env })).status).toBe(503);
      expect(await dailyUsed(env)).toBe(180);
    });
  });

  it('keys the day counter on the Eastern-time date', async () => {
    const env = voiceEnv(hears('hi').ai);
    await post(form({ durationMs: 1000 }), { env });
    const name = `global:voice:${etDay()}`;
    expect(globalVoiceName()).toBe(name);
    expect(await fixedCount(env, name)).toBe(1);
  });

  it('still returns the transcript when the limiter fails after the call, and logs limiter_error', async () => {
    const logs = captureLogs();
    const real = testEnv().LIMITER;
    const flaky = {
      getByName: (name: string) => {
        const stub = real.getByName(name);
        return {
          peek: (...args: Parameters<typeof stub.peek>) => stub.peek(...args),
          hit: (...args: Parameters<typeof stub.hit>) =>
            name.startsWith('session-voice:') || name.startsWith('global:voice:')
              ? Promise.reject(new Error('do exploded'))
              : stub.hit(...args),
        };
      },
    };
    const res = await post(form({ durationMs: 2000 }), { env: voiceEnv(hears('what do you do').ai, { LIMITER: flaky }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: 'what do you do' });
    expect(logs.some((line) => line.includes('"event":"limiter_error"'))).toBe(true);
    expect(logs.join('\n')).not.toMatch(/exploded/);
  });
});

describe('POST /stt when Workers AI misbehaves', () => {
  it('retries once, and answers with the second attempt', async () => {
    let calls = 0;
    const stub = aiStub(() => {
      calls += 1;
      if (calls === 1) throw new Error('upstream hiccup');
      return { text: 'second time lucky' };
    });
    const logs = captureLogs();
    const res = await post(form({ durationMs: 2000 }), { env: voiceEnv(stub.ai) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: 'second time lucky' });
    expect(stub.run).toHaveBeenCalledTimes(2);
    expect(logs.some((line) => line.includes('"event":"stt_error"') && line.includes('"retry":true'))).toBe(true);
  });

  it('answers 503 with reason "server" when it fails twice', async () => {
    const stub = aiStub(() => {
      throw new Error('boom: private words');
    });
    captureLogs();
    const res = await post(form({ durationMs: 2000 }), { env: voiceEnv(stub.ai) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
    expect(stub.run).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['no text field', {}],
    ['a text that is not a string', { text: 42 }],
    ['nothing at all', null],
  ])('treats a result with %s as a failed attempt', async (_label, result) => {
    const stub = aiStub(() => result);
    captureLogs();
    const res = await post(form(), { env: voiceEnv(stub.ai) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
    expect(stub.run).toHaveBeenCalledTimes(2);
  });

  it('gives up on an attempt that takes too long, aborts its request, and does not retry a timeout', async () => {
    const signals: AbortSignal[] = [];
    const stub = aiStub((_model, _input, options) => {
      signals.push(options?.signal as AbortSignal);
      return new Promise(() => undefined); // never answers
    });
    const logs = captureLogs();
    const started = performance.now();
    const res = await post(form(), { env: voiceEnv(stub.ai) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
    expect(performance.now() - started).toBeLessThan(500);
    expect(stub.run).toHaveBeenCalledTimes(1); // one attempt, not two
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(true);
    const errors = logs.filter((line) => line.includes('"event":"stt_error"')).map((line) => JSON.parse(line));
    expect(errors).toEqual([expect.objectContaining({ retry: false, error: 'AiTimeoutError' })]);
  });

  it('retries a failure that was not a timeout, and does not retry again if that second attempt times out', async () => {
    let calls = 0;
    const stub = aiStub(() => {
      calls += 1;
      if (calls === 1) throw new Error('upstream hiccup');
      return new Promise(() => undefined);
    });
    captureLogs();
    const res = await post(form(), { env: voiceEnv(stub.ai) });
    expect(res.status).toBe(503);
    expect(stub.run).toHaveBeenCalledTimes(2);
  });

  it("keeps the worst case well under the widget's 20 seconds: 8 s per attempt, a retry only after a quick failure", () => {
    expect(AI_ATTEMPT_TIMEOUT_MS).toBe(8000);
    // A failure just before the timeout, the 400 ms pause, then a full timeout on the retry.
    expect(2 * AI_ATTEMPT_TIMEOUT_MS + 400).toBeLessThan(20_000);
  });

  it('passes a live abort signal to the model call', async () => {
    let signal: AbortSignal | undefined;
    const stub = aiStub((_model, _input, options) => {
      signal = options?.signal as AbortSignal;
      return { text: 'fine' };
    });
    await post(form(), { env: voiceEnv(stub.ai) });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it('still charges the budget for a request the model could not answer (the audio was accepted)', async () => {
    const stub = aiStub(() => {
      throw new Error('boom');
    });
    captureLogs();
    const env = voiceEnv(stub.ai);
    await post(form({ durationMs: 3000 }), { env });
    expect(await dailyUsed(env)).toBe(3);
  });
});

describe('POST /stt when the limiter is unavailable', () => {
  const failing = {
    getByName: () => ({
      hit: () => Promise.reject(new Error('do exploded')),
      peek: () => Promise.reject(new Error('do exploded')),
      end: () => Promise.reject(new Error('do exploded')),
    }),
  };

  it('answers 503 with reason "server", makes no model call, and logs limiter_error', async () => {
    const logs = captureLogs();
    const stub = hears('x');
    const res = await post(form(), { env: voiceEnv(stub.ai, { LIMITER: failing }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable', reason: 'server' });
    expect(stub.run).not.toHaveBeenCalled();
    expect(logs.some((line) => line.includes('"event":"limiter_error"'))).toBe(true);
    expect(logs.join('\n')).not.toMatch(/exploded/);
  });
});

describe('POST /stt logging', () => {
  const SECRET_WORDS = 'my account number is four five six';

  it('logs one stt line with counters only: no transcript, no audio, no ids', async () => {
    const logs = captureLogs();
    const sessionId = randomUuid();
    const ip = randomIp();
    const audio = clip(3000);
    const stub = hears(SECRET_WORDS);
    const res = await post(form({ sessionId, audio, durationMs: 4200 }), { env: voiceEnv(stub.ai), ip });
    expect(res.status).toBe(200);

    const sttLines = logs.filter((line) => line.includes('"event":"stt"'));
    expect(sttLines).toHaveLength(1);
    const parsed = JSON.parse(sttLines[0]!);
    expect(Object.keys(parsed).sort()).toEqual(['audioBytes', 'event', 'ms', 'seconds', 'status']);
    expect(parsed).toMatchObject({ event: 'stt', status: 200, audioBytes: 3000, seconds: 5 });
    expect(typeof parsed.ms).toBe('number');

    const everything = logs.join('\n');
    expect(everything).not.toContain(SECRET_WORDS);
    expect(everything).not.toContain('account number');
    expect(everything).not.toContain(sessionId);
    expect(everything).not.toContain(ip);
    expect(everything).not.toContain(stub.run.mock.calls[0]![1].audio.slice(0, 40));
  });

  it('logs a 503 stt line and error names, but never the error message, when the model fails', async () => {
    const logs = captureLogs();
    const stub = aiStub(() => {
      throw new Error(`could not hear ${SECRET_WORDS}`);
    });
    await post(form({ durationMs: 2000 }), { env: voiceEnv(stub.ai) });
    const all = logs.join('\n');
    expect(all).not.toContain(SECRET_WORDS);
    const final = JSON.parse(logs.filter((line) => line.includes('"event":"stt"')).at(-1)!);
    expect(final).toMatchObject({ event: 'stt', status: 503, seconds: 2 });
    const errorLines = logs.filter((line) => line.includes('"event":"stt_error"')).map((line) => JSON.parse(line));
    expect(errorLines).toHaveLength(2);
    expect(errorLines[0]).toMatchObject({ retry: true, error: 'Error' });
    expect(errorLines[1]).toMatchObject({ retry: false });
  });
});
