import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import KNOWLEDGE from '../knowledge.md';
import SYSTEM_PROMPT_TEMPLATE from '../system-prompt.md';
import { FALLBACK_REPLY, OFF_TOPIC_REPLY } from './copy';
import { isMockProvider, llmApiKey, type Env } from './env';
import { mockReply } from './mock';
import { clampLength, sanitizeText } from './sanitize';
import { sleep } from './util';
import { CALLBACK_WINDOWS, EMPTY_LEAD, sanitizeLeadFields, type ChatMessage } from './validation';

// --- reply shape -----------------------------------------------------------------

const INTENTS = ['answer', 'pricing', 'off_topic', 'handoff', 'unsure', 'collecting'] as const;
// The callback window in `lead` is one of the four values, or "" while the visitor has not chosen one.
const LEAD_WINDOWS = ['', ...CALLBACK_WINDOWS] as const;

/**
 * Validates the parsed JSON after the call. Kept next to REPLY_JSON_SCHEMA; a test
 * checks the two agree. The lead fields are cleaned afterwards by sanitizeLeadFields.
 */
const LeadSchema = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  business: z.string(),
  need: z.string(),
  callbackWindow: z.enum(LEAD_WINDOWS),
});

export const ReplySchema = z.object({
  reply: z.string(),
  intent: z.enum(INTENTS),
  offerCallback: z.boolean(),
  readyToConfirm: z.boolean(),
  lead: LeadSchema,
});
export type Reply = z.infer<typeof ReplySchema>;

/**
 * Written by hand on purpose (plan section 2.4). The SDK's zod helper drops `enum`
 * under zod 4, which would turn `intent` into a hint instead of a constraint.
 * Every property is required at both levels and extra properties are refused.
 */
export const REPLY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    intent: { type: 'string', enum: INTENTS },
    offerCallback: { type: 'boolean' },
    readyToConfirm: { type: 'boolean' },
    lead: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        business: { type: 'string' },
        need: { type: 'string' },
        callbackWindow: { type: 'string', enum: LEAD_WINDOWS },
      },
      required: ['name', 'phone', 'email', 'business', 'need', 'callbackWindow'],
      additionalProperties: false,
    },
  },
  required: ['reply', 'intent', 'offerCallback', 'readyToConfirm', 'lead'],
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

/** A reply that carries no visitor details. Every answer has `lead` and `readyToConfirm`, even the canned ones. */
const withoutDetails = (reply: string, intent: Reply['intent'], offerCallback: boolean): Reply => ({
  reply,
  intent,
  offerCallback,
  readyToConfirm: false,
  lead: { ...EMPTY_LEAD },
});

const fallbackReply = (): Reply => withoutDetails(FALLBACK_REPLY, 'unsure', true);

/** The off-topic decline, used when a guard answers without calling the model. */
export const offTopicReply = (): Reply => withoutDetails(OFF_TOPIC_REPLY, 'off_topic', false);

/**
 * Applies the server's rules to a reply's visitor details (contract section 1.1): the lead fields
 * are cleaned, and `readyToConfirm` is DERIVED from the cleaned lead: true exactly when it holds a
 * name and a 10-digit phone number. The model's own flag is ignored, in both directions (it stays
 * in the schema so the prompt can talk about wrapping up, but the server's value wins). A model
 * that forgets the flag therefore cannot stop the form appearing, and one that sets it early cannot
 * make it appear without a number to call. Used for the model's output and the mock's.
 */
const enforceLead = (reply: Reply): Reply => {
  const lead = sanitizeLeadFields(reply.lead);
  return { ...reply, lead, readyToConfirm: lead.name !== '' && /^\d{10}$/.test(lead.phone) };
};

// --- client seam -----------------------------------------------------------------

/** The slice of `client.messages.create` this module uses; tests pass a stub. */
export interface CreateParams {
  model: string;
  max_tokens: number;
  system: string;
  messages: ChatMessage[];
  output_config: { effort: 'medium'; format: { type: 'json_schema'; schema: typeof REPLY_JSON_SCHEMA } };
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
  output_config: { effort: 'medium', format: { type: 'json_schema', schema: REPLY_JSON_SCHEMA } },
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

// --- anthropic provider ----------------------------------------------------------

type Outcome = 'ok' | 'refusal' | 'max_tokens' | 'parse_error' | 'empty';

const isRetryable = (error: unknown): boolean =>
  error instanceof Anthropic.APIConnectionError ||
  (error instanceof Anthropic.APIError && typeof error.status === 'number' && error.status >= 500);

const statusOf = (error: unknown): number =>
  error instanceof Anthropic.APIError && typeof error.status === 'number' ? error.status : 0;


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
  return { reply: enforceLead({ ...parsed.data, reply }), outcome: 'ok' };
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
  if (isMockProvider(env)) return enforceLead(mockReply(turns));
  const apiKey = llmApiKey(env);
  if (!apiKey) throw new LlmUnavailableError('LLM_API_KEY is not set');
  const client = deps.client ?? createAnthropicClient(apiKey, deps.timeoutMs ?? ATTEMPT_TIMEOUT_MS);
  return callModel(env, turns, client, deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
};
