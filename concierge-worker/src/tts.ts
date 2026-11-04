import { AI_ATTEMPT_TIMEOUT_MS, unavailable, withTimeout, type VoiceDeps } from './ai';
import { ENDED } from './copy';
import { dailyTtsChars, voiceSpeaker, type Env } from './env';
import { json, readJson, retryAfterSeconds } from './http';
import {
  CHAT_SESSION,
  TTS_IP,
  globalTtsName,
  hitLimiter,
  orLimiterDown,
  peekLimiter,
  sessionName,
  ttsDailyRule,
  ttsIpName,
  viaLimiter,
} from './limits';
import { sanitizeText } from './sanitize';
import { isRecord } from './util';
import { isValidSessionId } from './validation';

export const TTS_MODEL = '@cf/deepgram/aura-1';

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

/**
 * POST /tts, available only while VOICE_TTS is "aura" (the route is a 404 otherwise; see index.ts).
 * Order: binding present -> read and check the request (400s use up no allowance) -> address limit ->
 * the session has chatted and is not ended -> the day's character budget -> Aura-1. The answer is the
 * model's MPEG stream, passed straight through.
 *
 * It speaks replies, so it only serves a session that has sent a chat message (403 `no_chat` otherwise) and
 * that /chat has not ended (403 `ended`). That is a read of the session, as in /stt: a request here is not a
 * chat message and never adds to its count. There is no retry: the widget falls back to the browser's voice
 * instead.
 *
 * The text is never logged, only its length. If the limiter is down, no model call is made.
 */
export const handleTts = async (request: Request, env: Env, deps: VoiceDeps | undefined): Promise<Response> => {
  const ai = env.AI;
  if (!ai) return unavailable('server');

  const body = await readJson(request, BODY_MAX_BYTES);
  if (!body.ok) return badRequest();
  const utterance = parseUtterance(body.value);
  if (utterance === null) return badRequest();

  return orLimiterDown(() => speak(request, env, ai, deps, utterance), () => unavailable('server'));
};

const speak = async (
  request: Request,
  env: Env,
  ai: Ai,
  deps: VoiceDeps | undefined,
  { sessionId, text }: Utterance,
): Promise<Response> => {
  const ip = request.headers.get('CF-Connecting-IP');

  // First, so that probing with made-up sessions is bounded too.
  const ipHit = await viaLimiter(hitLimiter(env, await ttsIpName(ip ?? 'unknown', env.RATE_SALT), TTS_IP));
  if (!ipHit.allowed) {
    return json({ error: 'rate_limited' }, 429, { 'Retry-After': retryAfterSeconds(ipHit.resetAt) });
  }

  // Read, not hit.
  const session = await viaLimiter(peekLimiter(env, sessionName(sessionId), CHAT_SESSION));
  if (session.ended) return json({ error: 'ended', reply: ENDED }, 403);
  if (session.count === 0) return json({ error: 'no_chat' }, 403);

  const day = await viaLimiter(hitLimiter(env, globalTtsName(), ttsDailyRule(dailyTtsChars(env)), text.length));
  if (!day.allowed) return unavailable('budget');

  const started = Date.now();
  let audio: Response | null = null;
  try {
    const raw = await withTimeout(deps?.timeoutMs ?? AI_ATTEMPT_TIMEOUT_MS, (signal) =>
      ai.run(TTS_MODEL, { text, speaker: voiceSpeaker(env), encoding: 'mp3' }, { returnRawResponse: true, signal }),
    );
    if (raw instanceof Response && raw.ok && raw.body) audio = raw;
    else await raw?.body?.cancel?.();
  } catch (error) {
    // The error's name only: its message can echo what was sent.
    console.error(JSON.stringify({ event: 'tts_error', ms: Date.now() - started, error: (error as Error)?.name ?? 'Error' }));
  }

  console.log(JSON.stringify({ event: 'tts', ms: Date.now() - started, status: audio ? 200 : 503, chars: text.length }));
  if (!audio) return unavailable('server');

  return new Response(audio.body, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
};
