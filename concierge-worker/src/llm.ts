import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import KNOWLEDGE from '../knowledge.md';
import SYSTEM_PROMPT_TEMPLATE from '../system-prompt.md';
import { FALLBACK_REPLY, HANDOFF, OFF_TOPIC_REPLY, PRICING_REPLY } from './copy';
import { isMockProvider, llmApiKey, type Env } from './env';
import { clampLength, sanitizeText } from './sanitize';
import type { ChatMessage } from './validation';

// --- reply shape -----------------------------------------------------------------

const INTENTS = ['answer', 'pricing', 'off_topic', 'handoff', 'unsure'] as const;

/**
 * Validates the parsed JSON after the call. Kept next to REPLY_JSON_SCHEMA; a test
 * checks the two agree.
 */
export const ReplySchema = z.object({
  reply: z.string(),
  intent: z.enum(INTENTS),
  offerCallback: z.boolean(),
});
export type Reply = z.infer<typeof ReplySchema>;

/**
 * Written by hand on purpose (plan section 2.4). The SDK's zod helper drops `enum`
 * under zod 4, which would turn `intent` into a hint instead of a constraint.
 */
export const REPLY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    intent: { type: 'string', enum: INTENTS },
    offerCallback: { type: 'boolean' },
  },
  required: ['reply', 'intent', 'offerCallback'],
  additionalProperties: false,
} as const;

/** The model could not be used (missing key, or the call failed twice). */
export class LlmUnavailableError extends Error {
  override readonly name = 'LlmUnavailableError';
}

const REPLY_MAX_CHARS = 1000; // keeps every assistant message inside the 1,000-char lead transcript limit
const MAX_TOKENS = 2048; // adaptive thinking counts toward this; the cap costs nothing unless it is used
const DEFAULT_MODEL = 'claude-haiku-5-5';
const DEFAULT_RETRY_DELAY_MS = 400;
const ATTEMPT_TIMEOUT_MS = 12_000;

// {{KNOWLEDGE}} is replaced once, when the module loads. A function replacer keeps
// "$" sequences in the knowledge text (the "$80K" sentence) from being read as patterns.
export const SYSTEM_PROMPT = SYSTEM_PROMPT_TEMPLATE.replace('{{KNOWLEDGE}}', () => KNOWLEDGE.trim());

const fallbackReply = (): Reply => ({ reply: FALLBACK_REPLY, intent: 'unsure', offerCallback: true });

// --- client seam -----------------------------------------------------------------

/** The slice of `client.messages.create` this module uses; tests pass a stub. */
export interface CreateParams {
  model: string;
  max_tokens: number;
  system: string;
  messages: ChatMessage[];
  output_config: { effort: 'low'; format: { type: 'json_schema'; schema: typeof REPLY_JSON_SCHEMA } };
}

export interface ContentBlock {
  type: string;
  /** Present on `text` blocks only. */
  text?: string;
}

export interface CreateResponse {
  stop_reason: string | null;
  content: ContentBlock[];
  usage: { input_tokens: number; output_tokens: number };
}

export interface LlmClient {
  messages: { create: (params: CreateParams) => Promise<CreateResponse> };
}

export interface GenerateDeps {
  client?: LlmClient;
  retryDelayMs?: number;
  /** Per-attempt timeout; overridable so tests do not wait 12 seconds. */
  timeoutMs?: number;
}

// Everything in a request that does not depend on the visitor or the environment.
const REQUEST_BASE = {
  max_tokens: MAX_TOKENS,
  system: SYSTEM_PROMPT,
  output_config: { effort: 'low', format: { type: 'json_schema', schema: REPLY_JSON_SCHEMA } },
} as const satisfies Omit<CreateParams, 'model' | 'messages'>;

// maxRetries: 0 because this module owns the retry policy (one retry on a 5xx or a dropped
// connection); the SDK's default of two retries would triple the worst-case latency.
const clientOptions = (apiKey: string, timeoutMs: number) => ({ apiKey, maxRetries: 0, timeout: timeoutMs });

const createAnthropicClient = (apiKey: string, timeoutMs: number): LlmClient => {
  const anthropic = new Anthropic(clientOptions(apiKey, timeoutMs));
  return {
    messages: {
      create: async (params) => {
        const response = await anthropic.messages.create(params);
        return {
          stop_reason: response.stop_reason,
          content: response.content.map((block): ContentBlock => (block.type === 'text' ? { type: 'text', text: block.text } : { type: block.type })),
          usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
        };
      },
    },
  };
};

// --- mock provider ---------------------------------------------------------------

/** Deterministic canned replies keyed on the latest user message. No network, no key. */
const mockReply = (turns: ChatMessage[]): Reply => {
  const text = (turns.findLast((turn) => turn.role === 'user')?.content ?? '').toLowerCase();
  if (/\b(price|prices|pricing|cost|costs|much)\b/.test(text)) {
    return { reply: PRICING_REPLY, intent: 'pricing', offerCallback: false };
  }
  if (/\b(person|human)\b/.test(text)) {
    return { reply: HANDOFF, intent: 'handoff', offerCallback: false };
  }
  if (/\b(essay|weather|joke)\b/.test(text)) {
    return { reply: OFF_TOPIC_REPLY, intent: 'off_topic', offerCallback: false };
  }
  if (/\b(call|callback|quote|demo)\b/.test(text)) {
    return {
      reply: 'Happy to help with that. Want me to have someone call you?',
      intent: 'answer',
      offerCallback: true,
    };
  }
  return {
    reply:
      'We help local businesses use AI to save time on the busywork, like missed calls, email, ads and bookkeeping.',
    intent: 'answer',
    offerCallback: false,
  };
};

// --- anthropic provider ----------------------------------------------------------

type Outcome = 'ok' | 'refusal' | 'max_tokens' | 'parse_error' | 'empty';

const isRetryable = (error: unknown): boolean =>
  error instanceof Anthropic.APIConnectionError ||
  (error instanceof Anthropic.APIError && typeof error.status === 'number' && error.status >= 500);

const statusOf = (error: unknown): number =>
  error instanceof Anthropic.APIError && typeof error.status === 'number' ? error.status : 0;

const sleep = (ms: number): Promise<void> => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/**
 * Turns a model response into a reply. Order matters: a refusal and a max_tokens stop are
 * handled before any content is read, then the first `text` block (the response may begin
 * with `thinking` blocks) is parsed and validated. Anything unusable becomes the fallback.
 */
const interpret = (response: CreateResponse): { reply: Reply; outcome: Outcome } => {
  if (response.stop_reason === 'refusal') return { reply: fallbackReply(), outcome: 'refusal' };
  if (response.stop_reason === 'max_tokens') return { reply: fallbackReply(), outcome: 'max_tokens' };

  const text = response.content.find((block) => block.type === 'text')?.text;
  let data: unknown;
  try {
    data = JSON.parse(text ?? '');
  } catch {
    return { reply: fallbackReply(), outcome: 'parse_error' };
  }
  const parsed = ReplySchema.safeParse(data);
  if (!parsed.success) return { reply: fallbackReply(), outcome: 'parse_error' };

  const reply = clampLength(sanitizeText(parsed.data.reply), REPLY_MAX_CHARS).trim();
  if (reply.length === 0) return { reply: fallbackReply(), outcome: 'empty' };
  return { reply: { ...parsed.data, reply }, outcome: 'ok' };
};

const callModel = async (env: Env, turns: ChatMessage[], client: LlmClient, retryDelayMs: number): Promise<Reply> => {
  const params: CreateParams = { ...REQUEST_BASE, model: env.MODEL?.trim() || DEFAULT_MODEL, messages: turns };

  for (let attempt = 1; ; attempt += 1) {
    const started = Date.now();
    try {
      const response = await client.messages.create(params);
      const { reply, outcome } = interpret(response);
      // Every path logs the real usage, including the fallback ones: a refusal or a cut-off
      // answer still cost tokens. Counters only, never message or reply text.
      console.log(
        JSON.stringify({
          event: 'llm',
          status: 200,
          stop_reason: response.stop_reason,
          outcome,
          ms: Date.now() - started,
          intent: reply.intent,
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        }),
      );
      return reply;
    } catch (error) {
      const retry = attempt === 1 && isRetryable(error);
      console.error(JSON.stringify({ event: 'llm_error', status: statusOf(error), ms: Date.now() - started, retry }));
      if (!retry) throw new LlmUnavailableError(`model call failed (status ${statusOf(error)})`);
      await sleep(retryDelayMs);
    }
  }
};

/**
 * Produces the helper's next reply for a thread that ends with a user message.
 * Throws LlmUnavailableError when the model cannot be used; the route turns that
 * into the 503 lead-only response.
 */
export const generateReply = async (env: Env, turns: ChatMessage[], deps: GenerateDeps = {}): Promise<Reply> => {
  if (isMockProvider(env)) return mockReply(turns);
  const apiKey = llmApiKey(env);
  if (!apiKey) throw new LlmUnavailableError('LLM_API_KEY is not set');
  const client = deps.client ?? createAnthropicClient(apiKey, deps.timeoutMs ?? ATTEMPT_TIMEOUT_MS);
  return callModel(env, turns, client, deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
};
