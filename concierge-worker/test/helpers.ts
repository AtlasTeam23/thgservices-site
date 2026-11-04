import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env as baseEnv } from 'cloudflare:workers';
import worker from '../src/index';
import type { Env } from '../src/env';

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
    ...overrides,
  }) as Env;

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
  /** Objects are JSON-encoded; strings are sent as-is. */
  body?: unknown;
  env?: Env;
  app?: { fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> };
}

export const call = async (path: string, options: CallOptions = {}): Promise<Response> => {
  const headers = new Headers(options.headers);
  if (options.origin !== null) headers.set('Origin', options.origin ?? 'https://thgservices.io');
  if (options.ip !== null) headers.set('CF-Connecting-IP', options.ip ?? randomIp());
  let body: string | undefined;
  if (options.body !== undefined) {
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
