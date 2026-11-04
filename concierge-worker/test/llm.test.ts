import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_REPLY, HANDOFF, OFF_TOPIC_REPLY, PRICING_REPLY } from '../src/copy';
import {
  LlmUnavailableError,
  REPLY_JSON_SCHEMA,
  ReplySchema,
  SYSTEM_PROMPT,
  generateReply,
  type CreateParams,
  type CreateResponse,
  type LlmClient,
} from '../src/llm';
import type { ChatMessage } from '../src/validation';
import { testEnv } from './helpers';

const user = (content: string): ChatMessage => ({ role: 'user', content });
const assistant = (content: string): ChatMessage => ({ role: 'assistant', content });

afterEach(() => vi.restoreAllMocks());

describe('mock provider', () => {
  const ask = (text: string) => generateReply(testEnv(), [user(text)]);

  it.each(['How much does it cost?', 'What is the price?', 'pricing please'])(
    'answers pricing questions (%s) with the fixed pricing line',
    async (text) => {
      expect(await ask(text)).toEqual({ reply: PRICING_REPLY, intent: 'pricing', offerCallback: false });
    },
  );

  it.each(['Can I talk to a person?', 'I want a human'])('hands off for %s', async (text) => {
    expect(await ask(text)).toEqual({ reply: HANDOFF, intent: 'handoff', offerCallback: false });
  });

  it.each(['Write me an essay', "What's the weather today?", 'tell me a joke'])(
    'declines off-topic requests like %s',
    async (text) => {
      expect(await ask(text)).toEqual({ reply: OFF_TOPIC_REPLY, intent: 'off_topic', offerCallback: false });
    },
  );

  it.each(['Can you call me?', 'I need a quote', 'Show me a demo'])('offers a callback for %s', async (text) => {
    const result = await ask(text);
    expect(result.offerCallback).toBe(true);
    expect(result.reply).toMatch(/Want me to have someone call you\?$/);
    expect(result.intent).toBe('answer');
  });

  it('gives a one-line answer otherwise, without offering a callback', async () => {
    const result = await ask('What do you do?');
    expect(result.intent).toBe('answer');
    expect(result.offerCallback).toBe(false);
    expect(result.reply.length).toBeGreaterThan(20);
    expect(result.reply).not.toContain('\n');
  });

  it('only looks at the latest user message', async () => {
    const result = await generateReply(testEnv(), [user('how much?'), assistant(PRICING_REPLY), user('What do you do?')]);
    expect(result.intent).toBe('answer');
  });

  it('does not need a key', async () => {
    await expect(generateReply(testEnv({ LLM_API_KEY: undefined }), [user('hi')])).resolves.toBeDefined();
  });
});

describe('system prompt', () => {
  it('has the knowledge section substituted exactly once', () => {
    expect(SYSTEM_PROMPT).not.toContain('{{KNOWLEDGE}}');
    expect(SYSTEM_PROMPT).toContain('You are the THG helper');
    expect(SYSTEM_PROMPT).toMatch(/KNOWLEDGE\n[\s\S]+$/);
  });

  it('carries the figures rule 3 allows, so the helper can quote them word for word', () => {
    expect(SYSTEM_PROMPT).toContain('25 years');
    expect(SYSTEM_PROMPT).toContain('15+ years');
    expect(SYSTEM_PROMPT).toContain('24/7');
    expect(SYSTEM_PROMPT).toContain("In some cases we've saved customers $80K a year while tripling return on ad spend.");
  });
});

// --- the hand-written schema -----------------------------------------------------

describe('REPLY_JSON_SCHEMA', () => {
  it('is exactly the schema in plan section 2.4, with the enum on intent', () => {
    expect(REPLY_JSON_SCHEMA).toEqual({
      type: 'object',
      properties: {
        reply: { type: 'string' },
        intent: { type: 'string', enum: ['answer', 'pricing', 'off_topic', 'handoff', 'unsure'] },
        offerCallback: { type: 'boolean' },
      },
      required: ['reply', 'intent', 'offerCallback'],
      additionalProperties: false,
    });
  });

  it('stays in step with the zod validator', () => {
    expect([...REPLY_JSON_SCHEMA.properties.intent.enum]).toEqual([...ReplySchema.shape.intent.options]);
    for (const intent of REPLY_JSON_SCHEMA.properties.intent.enum) {
      expect(ReplySchema.safeParse({ reply: 'x', intent, offerCallback: false }).success).toBe(true);
    }
    expect(ReplySchema.safeParse({ reply: 'x', intent: 'smalltalk', offerCallback: true }).success).toBe(false);
    expect(ReplySchema.safeParse({ reply: 'x', intent: 'answer' }).success).toBe(false);
  });
});

// --- anthropic provider, with a stubbed client -------------------------------

const GOOD_REPLY = { reply: 'We help local businesses save time with AI.', intent: 'answer', offerCallback: false };
const USAGE = { input_tokens: 2400, output_tokens: 90 };

const respond = (text: string | null, overrides: Partial<CreateResponse> = {}): CreateResponse => ({
  stop_reason: 'end_turn',
  content: text === null ? [] : [{ type: 'text', text }],
  usage: USAGE,
  ...overrides,
});
const ok = (reply: unknown = GOOD_REPLY, overrides: Partial<CreateResponse> = {}) => respond(JSON.stringify(reply), overrides);

const stubClient = (...outcomes: Array<CreateResponse | Error>) => {
  const create = vi.fn(async (_params: CreateParams): Promise<CreateResponse> => {
    const next = outcomes.shift();
    if (next === undefined) throw new Error('stub ran out of outcomes');
    if (next instanceof Error) throw next;
    return next;
  });
  const client: LlmClient = { messages: { create } };
  return { client, create };
};

const anthropicEnv = (extra: Record<string, unknown> = {}) =>
  testEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'placeholder-not-a-real-key', ...extra });
const run = (client: LlmClient, turns: ChatMessage[] = [user('What do you do?')], env = anthropicEnv()) =>
  generateReply(env, turns, { client, retryDelayMs: 0 });

const captureLogs = () => {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  return lines;
};

describe('anthropic provider request', () => {
  it('sends exactly the contracted request shape', async () => {
    const { client, create } = stubClient(ok());
    await run(client, [user('Hi'), assistant('Hello!'), user('What do you do?')]);

    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0]![0];
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.max_tokens).toBe(2048);
    expect(params.system).toBe(SYSTEM_PROMPT);
    expect(params.messages).toEqual([user('Hi'), assistant('Hello!'), user('What do you do?')]);
    expect(params.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema: REPLY_JSON_SCHEMA } });
  });

  it('sends none of the parameters that the model rejects or the plan forbids', async () => {
    const { client, create } = stubClient(ok());
    await run(client);
    const sent = Object.keys(create.mock.calls[0]![0]).sort();
    expect(sent).toEqual(['max_tokens', 'messages', 'model', 'output_config', 'system']);
    for (const forbidden of ['temperature', 'top_p', 'top_k', 'thinking', 'fallbacks', 'betas', 'tools', 'stream']) {
      expect(sent).not.toContain(forbidden);
    }
    expect(create.mock.calls[0]![0].messages.at(-1)?.role).toBe('user'); // no assistant prefill
  });

  it('takes the model name from the MODEL var', async () => {
    const { client, create } = stubClient(ok());
    await run(client, [user('hi')], anthropicEnv({ MODEL: 'claude-test-model' }));
    expect(create.mock.calls[0]![0].model).toBe('claude-test-model');
  });
});

describe('anthropic provider responses', () => {
  it('returns the validated reply on a normal turn', async () => {
    const { client } = stubClient(ok());
    expect(await run(client)).toEqual(GOOD_REPLY);
  });

  it('reads blocks by type: a thinking block before the text block still parses', async () => {
    const { client } = stubClient(
      respond(null, {
        content: [
          { type: 'thinking' },
          { type: 'text', text: JSON.stringify({ reply: 'After thinking.', intent: 'answer', offerCallback: true }) },
        ],
      }),
    );
    expect(await run(client)).toEqual({ reply: 'After thinking.', intent: 'answer', offerCallback: true });
  });

  it('uses the text block even when other block types follow it', async () => {
    const { client } = stubClient(respond(null, { content: [{ type: 'text', text: JSON.stringify(GOOD_REPLY) }, { type: 'thinking' }] }));
    expect((await run(client)).reply).toBe(GOOD_REPLY.reply);
  });

  it.each([
    ['a refusal with no content', respond(null, { stop_reason: 'refusal' })],
    ['a refusal that somehow carries valid JSON', ok(GOOD_REPLY, { stop_reason: 'refusal' })],
    ['a cut-off at max_tokens', respond('{"reply":"We help loc', { stop_reason: 'max_tokens' })],
    ['a max_tokens stop even when the JSON happens to be complete', ok(GOOD_REPLY, { stop_reason: 'max_tokens' })],
    ['text that is not JSON', respond('Sorry, I cannot do that.')],
    ['an empty text block', respond('')],
    ['a response with no text block at all', respond(null, { content: [{ type: 'thinking' }] })],
    ['an intent outside the enum', ok({ reply: 'Hi!', intent: 'smalltalk', offerCallback: false })],
    ['a missing field', ok({ reply: 'Hi!', intent: 'answer' })],
    ['a wrong field type', ok({ reply: 'Hi!', intent: 'answer', offerCallback: 'yes' })],
    ['JSON that is not an object', respond('[1,2,3]')],
    ['a reply that is empty once markup is stripped', ok({ reply: '  <i></i> ', intent: 'answer', offerCallback: false })],
  ])('shows the fallback reply (with a callback offer) for %s', async (_label, response) => {
    const { client, create } = stubClient(response);
    expect(await run(client)).toEqual({ reply: FALLBACK_REPLY, intent: 'unsure', offerCallback: true });
    expect(create).toHaveBeenCalledTimes(1); // a bad answer is never retried
  });

  it('keeps a reply to 1,000 characters so it always fits a lead transcript', async () => {
    const { client } = stubClient(ok({ ...GOOD_REPLY, reply: 'a'.repeat(1500) }));
    expect((await run(client)).reply).toHaveLength(1000);
  });

  it('strips markup and control characters from the reply', async () => {
    const { client } = stubClient(ok({ ...GOOD_REPLY, reply: '<b>Hi</b>\u0007 there' }));
    expect((await run(client)).reply).toBe('Hi there');
  });
});

describe('llm log line', () => {
  const LOG_KEYS = ['event', 'input_tokens', 'intent', 'ms', 'outcome', 'output_tokens', 'status', 'stop_reason'];

  it('logs stop_reason, outcome and real token usage on a normal turn', async () => {
    const lines = captureLogs();
    const { client } = stubClient(ok());
    await run(client, [user('my private question about pricing for Doe Plumbing')]);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(LOG_KEYS);
    expect(entry).toMatchObject({
      event: 'llm',
      status: 200,
      stop_reason: 'end_turn',
      outcome: 'ok',
      intent: 'answer',
      input_tokens: 2400,
      output_tokens: 90,
    });
  });

  it.each([
    ['refusal', respond(null, { stop_reason: 'refusal', usage: { input_tokens: 2400, output_tokens: 7 } }), 'refusal', 'refusal', 7],
    ['max_tokens', respond('{"reply":"We help loc', { stop_reason: 'max_tokens', usage: { input_tokens: 2400, output_tokens: 2048 } }), 'max_tokens', 'max_tokens', 2048],
    ['parse_error', respond('not json', { usage: { input_tokens: 2400, output_tokens: 12 } }), 'end_turn', 'parse_error', 12],
    ['empty', ok({ ...GOOD_REPLY, reply: '<b></b>' }, { usage: { input_tokens: 2400, output_tokens: 15 } }), 'end_turn', 'empty', 15],
  ])('logs the real usage on the %s path', async (_label, response, stopReason, outcome, outputTokens) => {
    const lines = captureLogs();
    const { client } = stubClient(response);
    await run(client);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      status: 200,
      stop_reason: stopReason,
      outcome,
      intent: 'unsure',
      input_tokens: 2400,
      output_tokens: outputTokens,
    });
  });

  it('a truncated JSON answer with stop_reason max_tokens logs its token counts and the outcome', async () => {
    const lines = captureLogs();
    const { client } = stubClient(respond('{"reply":"We help local busin', { stop_reason: 'max_tokens', usage: { input_tokens: 2511, output_tokens: 2048 } }));
    expect((await run(client)).reply).toBe(FALLBACK_REPLY);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry).toMatchObject({ stop_reason: 'max_tokens', outcome: 'max_tokens', input_tokens: 2511, output_tokens: 2048 });
  });

  it('never logs message text or reply text', async () => {
    const lines = captureLogs();
    const { client } = stubClient(ok(), respond('{"reply":"private reply text', { stop_reason: 'max_tokens' }));
    await run(client, [user('my secret question about Doe Plumbing')]);
    await run(client, [user('another private question')]);
    const text = lines.join('\n');
    expect(text).not.toMatch(/secret question|Doe Plumbing|private question|private reply|We help local businesses/);
  });
});

const apiError = (status: number) => Anthropic.APIError.generate(status, { error: { message: 'boom' } }, 'boom', new Headers());

describe('anthropic provider failures', () => {
  it('retries once after a 5xx and returns the second answer', async () => {
    const { client, create } = stubClient(apiError(500), ok());
    expect((await run(client)).intent).toBe('answer');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('retries once after an overloaded (529) response', async () => {
    const { client, create } = stubClient(apiError(529), ok());
    await run(client);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('retries once after a connection error', async () => {
    const { client, create } = stubClient(new Anthropic.APIConnectionError({ message: 'connection reset' }), ok());
    await run(client);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('gives up with LlmUnavailableError after a second failure', async () => {
    const { client, create } = stubClient(apiError(500), apiError(502));
    await expect(run(client)).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 404, 413, 429])('does not retry a %i and gives up immediately', async (status) => {
    const { client, create } = stubClient(apiError(status), ok());
    await expect(run(client)).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('gives up on an unexpected non-API error without retrying', async () => {
    const { client, create } = stubClient(new TypeError('unexpected'), ok());
    await expect(run(client)).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('is unavailable when the provider is anthropic and no key is set', async () => {
    const { client, create } = stubClient(ok());
    const env = testEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: undefined });
    await expect(generateReply(env, [user('hi')], { client })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(create).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only key as no key', async () => {
    const { client, create } = stubClient(ok());
    const env = testEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: '  \n' });
    await expect(generateReply(env, [user('hi')], { client })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(create).not.toHaveBeenCalled();
  });
});

// --- real SDK, stubbed network ---------------------------------------------------

const apiMessage = (blocks: unknown[], overrides: Record<string, unknown> = {}) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-5-5',
  content: blocks,
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 2400, output_tokens: 90 },
  ...overrides,
});
const textBlock = (text: string) => ({ type: 'text', text });

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const errorBody = (type: string) => ({ type: 'error', error: { type, message: 'x' } });

const stubFetch = (...responses: Response[]) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const next = responses.shift();
    if (!next) throw new Error('fetch stub ran out of responses');
    return next;
  });

const GOOD_TEXT = JSON.stringify(GOOD_REPLY);
const wireRun = (turns: ChatMessage[] = [user('What do you do?')], env = anthropicEnv(), timeoutMs?: number) =>
  generateReply(env, turns, { retryDelayMs: 0, ...(timeoutMs === undefined ? {} : { timeoutMs }) });

describe('anthropic provider over the wire (real SDK, stubbed fetch)', () => {
  it('posts the contracted request to the Messages API', async () => {
    const fetchSpy = stubFetch(jsonResponse(apiMessage([textBlock(GOOD_TEXT)])));
    expect(await wireRun([user('Hi'), assistant('Hello!'), user('What do you do?')])).toEqual(GOOD_REPLY);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [input, init] = fetchSpy.mock.calls[0]!;
    expect(String(input)).toBe('https://api.anthropic.com/v1/messages');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    // SDK 1.x sends the API key as a bearer credential.
    expect(headers.get('authorization')).toBe('Bearer placeholder-not-a-real-key');
    expect(headers.get('anthropic-version')).toBeTruthy();

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'output_config', 'system']);
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.max_tokens).toBe(2048);
    expect(body.system).toBe(SYSTEM_PROMPT);
    expect(body.messages).toEqual([user('Hi'), assistant('Hello!'), user('What do you do?')]);
    expect(body.output_config).toEqual({
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            reply: { type: 'string' },
            intent: { type: 'string', enum: ['answer', 'pricing', 'off_topic', 'handoff', 'unsure'] },
            offerCallback: { type: 'boolean' },
          },
          required: ['reply', 'intent', 'offerCallback'],
          additionalProperties: false,
        },
      },
    });
  });

  it('trims whitespace around the API key before using it', async () => {
    const fetchSpy = stubFetch(jsonResponse(apiMessage([textBlock(GOOD_TEXT)])));
    await wireRun([user('hi')], anthropicEnv({ LLM_API_KEY: '  placeholder-not-a-real-key\n' }));
    expect(new Headers(fetchSpy.mock.calls[0]![1]?.headers).get('authorization')).toBe('Bearer placeholder-not-a-real-key');
  });

  it('gives each attempt 12 seconds by default', async () => {
    const fetchSpy = stubFetch(jsonResponse(apiMessage([textBlock(GOOD_TEXT)])));
    await wireRun();
    expect(new Headers(fetchSpy.mock.calls[0]![1]?.headers).get('x-stainless-timeout')).toBe('12');
  });

  it('turns the SDK retries off, so the only retry is the Worker\'s own', async () => {
    const fetchSpy = stubFetch(jsonResponse(apiMessage([textBlock(GOOD_TEXT)])));
    await wireRun();
    expect(new Headers(fetchSpy.mock.calls[0]![1]?.headers).get('x-stainless-retry-count')).toBe('0');
  });

  it('parses a response that starts with a thinking block', async () => {
    stubFetch(
      jsonResponse(apiMessage([{ type: 'thinking', thinking: '', signature: 'sig' }, textBlock(GOOD_TEXT)], { usage: { input_tokens: 2400, output_tokens: 310 } })),
    );
    const lines = captureLogs();
    expect(await wireRun()).toEqual(GOOD_REPLY);
    expect(JSON.parse(lines[0]!)).toMatchObject({ outcome: 'ok', output_tokens: 310 });
  });

  it('shows the fallback reply (not an outage) when the model returns an intent outside the enum', async () => {
    const fetchSpy = stubFetch(jsonResponse(apiMessage([textBlock(JSON.stringify({ reply: 'Hi!', intent: 'smalltalk', offerCallback: false }))])));
    expect(await wireRun()).toEqual({ reply: FALLBACK_REPLY, intent: 'unsure', offerCallback: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('shows the fallback reply when the answer is cut off at max_tokens, and logs the usage', async () => {
    stubFetch(jsonResponse(apiMessage([textBlock('{"reply":"We help loc')], { stop_reason: 'max_tokens', usage: { input_tokens: 2500, output_tokens: 2048 } })));
    const lines = captureLogs();
    expect((await wireRun()).reply).toBe(FALLBACK_REPLY);
    expect(JSON.parse(lines[0]!)).toMatchObject({ stop_reason: 'max_tokens', outcome: 'max_tokens', input_tokens: 2500, output_tokens: 2048 });
  });

  it('shows the fallback reply for a refusal with no content', async () => {
    stubFetch(jsonResponse(apiMessage([], { stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null } })));
    expect(await wireRun()).toEqual({ reply: FALLBACK_REPLY, intent: 'unsure', offerCallback: true });
  });

  it('makes exactly two attempts in total on persistent 5xx, because the SDK adds none of its own', async () => {
    const fetchSpy = stubFetch(jsonResponse(errorBody('api_error'), 500), jsonResponse(errorBody('api_error'), 502));
    await expect(wireRun()).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('recovers when the retry succeeds', async () => {
    const fetchSpy = stubFetch(jsonResponse(errorBody('overloaded_error'), 529), jsonResponse(apiMessage([textBlock(GOOD_TEXT)])));
    expect((await wireRun()).intent).toBe('answer');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 429])('gives up at once on a %i (one attempt)', async (status) => {
    const fetchSpy = stubFetch(jsonResponse(errorBody('invalid_request_error'), status));
    await expect(wireRun()).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries once when the network drops, then gives up', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));
    await expect(wireRun()).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('times out a hanging request per attempt, retries once, then gives up', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const started = Date.now();
    await expect(wireRun([user('hi')], anthropicEnv(), 60)).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
