import { createExecutionContext, runInDurableObject, waitOnExecutionContext } from 'cloudflare:test';
import { env as baseEnv } from 'cloudflare:workers';
import { vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/env';
import { sessionName } from '../src/limits';

/**
 * A hermetic Env for tests: bindings and public vars come from wrangler.jsonc
 * (the real Limiter Durable Object included), while every secret is forced off
 * so a developer's local `.dev.vars` can never change a result. Pass overrides
 * to switch individual settings on for one test.
 */
export const testEnv = (overrides: Partial<Record<keyof Env, unknown>> = {}): Env =>
  ({
    ...baseEnv,
    LLM_PROVIDER: 'mock',
    LLM_API_KEY: undefined,
    RESEND_API_KEY: undefined,
    TURNSTILE_SECRET_KEY: undefined,
    LEADQUIK_WEBHOOK_URL: undefined,
    ELEVENLABS_API_KEY: undefined,
    // The shipped config names a paid voice; the suite's baseline is no spoken replies, and the voice tests
    // switch a provider on per test (elevenEnv(), aura overrides), so the production voice id never
    // changes a result.
    VOICE_TTS: 'browser',
    VOICE_ELEVEN_VOICE_ID: '',
    // Workers AI runs on Cloudflare's network, never in the test runtime: voice tests pass `aiStub().ai`.
    AI: undefined,
    ...overrides,
  }) as Env;

/** Shape of `env.AI.run(model, input, options)` for a stub. */
export type AiHandler = (model: string, input: Record<string, any>, options?: Record<string, any>) => unknown;

/**
 * A stand-in for the Workers AI binding. `run` records every call (`run.mock.calls`) and answers with
 * whatever `handler` returns or throws.
 */
export const aiStub = (handler: AiHandler = () => ({ text: '' })) => {
  const run = vi.fn(async (model: string, input: Record<string, any>, options?: Record<string, any>) =>
    handler(model, input, options),
  );
  return { ai: { run } as unknown as Ai, run };
};

/** A fresh documentation-range IPv4 per call so rate-limit buckets never collide between tests. */
export const randomIp = (): string => {
  const rand = () => Math.floor(Math.random() * 254) + 1;
  return `198.51.${rand()}.${rand()}`;
};

export const randomUuid = (): string => crypto.randomUUID();

export interface CallOptions {
  method?: string;
  origin?: string | null;
  ip?: string | null;
  headers?: Record<string, string>;
  /** Objects are JSON-encoded; strings are sent as-is; FormData is sent as multipart. */
  body?: unknown;
  env?: Env;
  app?: { fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> };
}

export const call = async (path: string, options: CallOptions = {}): Promise<Response> => {
  const headers = new Headers(options.headers);
  if (options.origin !== null) headers.set('Origin', options.origin ?? 'https://thgservices.io');
  if (options.ip !== null) headers.set('CF-Connecting-IP', options.ip ?? randomIp());
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body; // the runtime adds the multipart Content-Type and boundary
  } else if (options.body !== undefined) {
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  }
  const request = new Request(`https://concierge.test${path}`, {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    headers,
    body,
  });
  const ctx = createExecutionContext();
  const response = await (options.app ?? worker).fetch(request, options.env ?? testEnv(), ctx);
  await waitOnExecutionContext(ctx);
  return response;
};

/** Captures everything the Worker writes with console.log / error / warn, so a test can read it (and keep the output quiet). */
export const captureLogs = (): string[] => {
  const lines: string[] = [];
  const grab = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  vi.spyOn(console, 'log').mockImplementation(grab);
  vi.spyOn(console, 'error').mockImplementation(grab);
  vi.spyOn(console, 'warn').mockImplementation(grab);
  return lines;
};

/** Reads a fixed counter's value without touching it (0 before its first hit). */
export const fixedCount = (env: Env, name: string): Promise<number> =>
  runInDurableObject(env.LIMITER.getByName(name), (_instance, ctx) => {
    try {
      return ctx.storage.sql.exec<{ count: number }>('SELECT count FROM counter WHERE id = 0').toArray()[0]?.count ?? 0;
    } catch {
      return 0; // the tables are created by the first hit
    }
  });

/** Hits recorded so far on a sliding counter, read without touching it (0 before its first hit). */
export const slidingCount = (env: Env, name: string): Promise<number> =>
  runInDurableObject(env.LIMITER.getByName(name), (_instance, ctx) => {
    try {
      return ctx.storage.sql.exec<{ c: number }>('SELECT COUNT(*) AS c FROM hits').one().c;
    } catch {
      return 0;
    }
  });

/** Messages counted so far against the session's 40-message cap, read without touching it. */
export const messagesUsed = (env: Env, sessionId: string): Promise<number> => slidingCount(env, sessionName(sessionId));

/** Sets the end of a fixed counter's window, the way the passing of a day (or of a few seconds) would. */
export const setWindowEnd = (env: Env, name: string, resetAt: number): Promise<void> =>
  runInDurableObject(env.LIMITER.getByName(name), (_instance, ctx) => {
    ctx.storage.sql.exec('UPDATE counter SET reset_at = ? WHERE id = 0', resetAt);
  });

/** Sends one chat message so the session exists as far as /tts is concerned (it only speaks for sessions that have chatted). */
export const chatOnce = async (sessionId: string = randomUuid()): Promise<string> => {
  const res = await call('/chat', { body: { sessionId, messages: [{ role: 'user', content: 'hello' }] } });
  if (res.status !== 200) throw new Error(`chatOnce: /chat answered ${res.status}`);
  return sessionId;
};
