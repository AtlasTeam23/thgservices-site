import { AI_ATTEMPT_TIMEOUT_MS, unavailable, withTimeout, type VoiceDeps } from './ai';
import { ENDED } from './copy';
import {
  dailyTtsChars,
  elevenConfig,
  ttsBonus,
  ttsPerIpPerDay,
  ttsProvider,
  ttsVoice,
  type ElevenConfig,
  type Env,
  type TtsVoice,
} from './env';
import { fetchElevenLabs } from './elevenlabs';
import { json, readJson, retryAfterSeconds } from './http';
import type { HitResult } from './limiter';
import {
  CHAT_SESSION,
  TTS_IP,
  globalTtsName,
  hitLimiter,
  orLimiterDown,
  peekLimiter,
  refundLimiter,
  sessionName,
  ttsBonusIpName,
  ttsDailyRule,
  ttsIpName,
  ttsSpokenIpName,
  untilMidnightRule,
  viaLimiter,
} from './limits';
import { clampLength, sanitizeText } from './sanitize';
import { isRecord } from './util';
import { isValidSessionId } from './validation';
import type { LeadPayload } from './validation';

/** Longest text spoken in one request: the longest reply /chat can produce, so any reply can be spoken. */
export const TTS_TEXT_MAX = 1000;
// Room for the session id and 1,000 characters even if JSON escapes every one (6 bytes each); anything
// larger is not a reply to speak.
const BODY_MAX_BYTES = 16 * 1024;

const badRequest = (): Response => json({ error: 'bad_request' }, 400);

interface Utterance {
  sessionId: string;
  /** Markup and control characters removed, 1 to 1,000 characters. */
  text: string;
}

/** The validated request, or null when the session id is not a uuid or the text is missing, not text, or empty/too long once cleaned. */
const parseUtterance = (body: unknown): Utterance | null => {
  if (!isRecord(body) || !isValidSessionId(body.sessionId) || typeof body.text !== 'string') return null;
  const text = sanitizeText(body.text);
  return text.length >= 1 && text.length <= TTS_TEXT_MAX ? { sessionId: body.sessionId, text } : null;
};

/** The paid voice to use and what it needs: Aura through the AI binding, or ElevenLabs through its API. */
type Source = { provider: 'aura'; ai: Ai; voice: TtsVoice } | { provider: 'elevenlabs'; config: ElevenConfig };

/** The selected provider, or null when it cannot run: no AI binding, or no ElevenLabs key or voice id. */
const sourceFor = (env: Env): Source | null => {
  const provider = ttsProvider(env);
  if (provider === 'aura') return env.AI ? { provider, ai: env.AI, voice: ttsVoice(env) } : null;
  if (provider === 'elevenlabs') {
    const config = elevenConfig(env);
    return config ? { provider, config } : null;
  }
  return null;
};

/**
 * POST /tts, available only while VOICE_TTS names a provider ("aura" or "elevenlabs"; the route is a 404
 * otherwise, see index.ts). Order: provider set up -> read and check the request (400s use up no allowance) ->
 * address limit (30 per 10 minutes) -> the session has chatted and is not ended -> the visitor's daily
 * allowance of spoken replies -> the day's character budget -> the provider. The answer is the provider's
 * audio stream, passed straight through as `audio/mpeg`.
 *
 * It speaks replies, so it only serves a session that has sent a chat message (403 `no_chat` otherwise) and
 * that /chat has not ended (403 `ended`). That is a read of the session, as in /stt: a request here is not a
 * chat message and never adds to its count. There is no retry: the widget falls back to the browser's voice
 * instead.
 *
 * The allowance is reserved before the provider is called, atomically, and given back if no audio is
 * delivered, so concurrent requests cannot spend more than the cap and a failure costs the visitor nothing.
 *
 * The text is never logged, only its length. If the limiter is down, no provider call is made.
 */
export const handleTts = async (request: Request, env: Env, deps: VoiceDeps | undefined): Promise<Response> => {
  const source = sourceFor(env);
  if (!source) return unavailable('server');

  const body = await readJson(request, BODY_MAX_BYTES);
  if (!body.ok) return badRequest();
  const utterance = parseUtterance(body.value);
  if (utterance === null) return badRequest();

  return orLimiterDown(() => speak(request, env, source, deps, utterance), () => unavailable('server'));
};

const speak = async (
  request: Request,
  env: Env,
  source: Source,
  deps: VoiceDeps | undefined,
  { sessionId, text }: Utterance,
): Promise<Response> => {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

  // First, so that probing with made-up sessions is bounded too.
  const ipHit = await viaLimiter(hitLimiter(env, await ttsIpName(ip, env.RATE_SALT), TTS_IP));
  if (!ipHit.allowed) {
    return json({ error: 'rate_limited' }, 429, { 'Retry-After': retryAfterSeconds(ipHit.resetAt) });
  }

  // Read, not hit.
  const session = await viaLimiter(peekLimiter(env, sessionName(sessionId), CHAT_SESSION));
  if (session.ended) return json({ error: 'ended', reply: ENDED }, 403);
  if (session.count === 0) return json({ error: 'no_chat' }, 403);

  // The visitor's allowance for today: PER_IP replies, plus BONUS once this address has left its contact
  // details. One counter per address that ends at Eastern midnight; the slot is counted now, atomically.
  const now = deps?.now?.() ?? new Date();
  const spokenName = await ttsSpokenIpName(ip, env.RATE_SALT);
  const bonus = await viaLimiter(peekLimiter(env, await ttsBonusIpName(ip, env.RATE_SALT), untilMidnightRule(1, now)));
  const bonusGranted = bonus.count >= 1;
  const bonusSize = ttsBonus(env);
  const cap = ttsPerIpPerDay(env) + (bonusGranted ? bonusSize : 0);
  const slot = await viaLimiter(hitLimiter(env, spokenName, untilMidnightRule(cap, now)));
  if (!slot.allowed) {
    // Never offer a bonus that is worth nothing. Retry-After follows the counter's own window end, not the
    // wall clock, so it cannot disagree with the counter that is actually refusing.
    return json({ error: 'tts_limit', bonusAvailable: !bonusGranted && bonusSize > 0, bonus: bonusSize }, 429, {
      'Retry-After': retryAfterSeconds(slot.resetAt),
    });
  }

  // From here the slot is the visitor's only if audio is delivered; every other way out hands back what this
  // request took: the slot and, once charged, the characters. Each refund is tied to the window it came from, so
  // a call that straddles Eastern midnight cannot credit the new day, and a refund that fails is logged.
  const budgetName = globalTtsName();
  let charged: HitResult | null = null;
  const refund = async (name: string, cost: number, window: HitResult): Promise<void> => {
    try {
      await refundLimiter(env, name, cost, window.resetAt);
    } catch {
      console.error(JSON.stringify({ event: 'limiter_error', where: 'tts_refund' }));
    }
  };
  const giveBack = async (): Promise<void> => {
    await refund(spokenName, 1, slot);
    if (charged !== null) await refund(budgetName, text.length, charged);
  };
  try {
    const day = await viaLimiter(hitLimiter(env, budgetName, ttsDailyRule(dailyTtsChars(env)), text.length));
    if (!day.allowed) {
      await giveBack();
      return unavailable('budget');
    }
    charged = day;

    const audio = await synthesize(source, deps, text);
    if (!audio) {
      await giveBack(); // a failing provider must not use up the visitor's reply or the day's characters
      return unavailable('server');
    }
    return new Response(audio.body, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    await giveBack();
    throw error;
  }
};

/**
 * One call to the provider, cut off after 8 seconds. Returns its 200 response (the body still streaming) or
 * null, having logged only the provider, the status or the error's name, and timings: never a response body,
 * the text, or the key.
 */
const synthesize = async (source: Source, deps: VoiceDeps | undefined, text: string): Promise<Response | null> => {
  // A speaker the chosen Aura model does not know would be a 400 on every reply; the model's default is used and
  // the operator is told. Config only: the rejected value is a var, not visitor text.
  if (source.provider === 'aura' && source.voice.fellBack) {
    console.warn(
      JSON.stringify({
        event: 'tts_speaker_fallback',
        model: source.voice.model,
        requested: clampLength(source.voice.requested ?? '', 32),
        used: source.voice.speaker,
      }),
    );
  }

  const provider = source.provider;
  const started = Date.now();
  let audio: Response | null = null;
  try {
    const res = await withTimeout(deps?.timeoutMs ?? AI_ATTEMPT_TIMEOUT_MS, (signal) =>
      source.provider === 'aura' ? runAura(source.ai, source.voice, text, signal) : fetchElevenLabs(source.config, text, signal),
    );
    if (res instanceof Response && res.status === 200 && res.body) {
      audio = res;
    } else {
      console.error(JSON.stringify({ event: 'tts_error', provider, ms: Date.now() - started, status: res instanceof Response ? res.status : 0 }));
      await res?.body?.cancel?.();
    }
  } catch (error) {
    // The error's name only: its message can echo what was sent.
    console.error(JSON.stringify({ event: 'tts_error', provider, ms: Date.now() - started, error: (error as Error)?.name ?? 'Error' }));
  }

  console.log(JSON.stringify({ event: 'tts', provider, ms: Date.now() - started, status: audio ? 200 : 503, chars: text.length }));
  return audio;
};

/** One Aura call asking for the raw MPEG response. The two models have different speaker types, hence the branch. */
const runAura = (ai: Ai, voice: TtsVoice, text: string, signal: AbortSignal): Promise<Response> => {
  const options = { returnRawResponse: true, signal } as const;
  return voice.model === 'aura-2'
    ? ai.run(voice.modelId, { text, speaker: voice.speaker, encoding: 'mp3' }, options)
    : ai.run(voice.modelId, { text, speaker: voice.speaker, encoding: 'mp3' }, options);
};

// --- the bonus a lead earns ------------------------------------------------------------

/**
 * A lead earns the visitor's address more spoken replies today when it carries a name, a valid email and a
 * 10-digit phone number. (The validator already insists on the name and phone; the email is the optional one.)
 */
export const earnsSpeechBonus = (lead: Pick<LeadPayload, 'name' | 'email' | 'phone'>): boolean =>
  lead.name.trim() !== '' && (lead.email ?? '').trim() !== '' && /^\d{10}$/.test(lead.phone);

/**
 * Records that this address has earned today's bonus: a daily counter set to 1. Setting it again changes
 * nothing, so it is safe to call for every qualifying lead. Does nothing while the browser voice is in use.
 * It runs after the lead has been delivered and must never turn that into a failure, so a limiter error is
 * logged and swallowed.
 */
export const grantSpeechBonus = async (env: Env, ip: string | null, now: Date): Promise<void> => {
  if (ttsProvider(env) === 'browser') return;
  try {
    await hitLimiter(env, await ttsBonusIpName(ip ?? 'unknown', env.RATE_SALT), untilMidnightRule(1, now));
  } catch {
    console.error(JSON.stringify({ event: 'limiter_error' }));
  }
};
