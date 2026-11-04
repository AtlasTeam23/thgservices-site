import { Buffer } from 'node:buffer';
import { AI_ATTEMPT_TIMEOUT_MS, AiTimeoutError, unavailable, withTimeout, type VoiceDeps } from './ai';
import { ENDED } from './copy';
import { dailySttSeconds, isSttAvailable, sessionVoiceSeconds, turnstileSecret, type Env } from './env';
import { json, readBytes, retryAfterSeconds } from './http';
import {
  CHAT_SESSION,
  STT_IP,
  TURNSTILE_AFTER_MESSAGES,
  chargeLimiter,
  globalVoiceName,
  hitLimiter,
  orLimiterDown,
  peekLimiter,
  sessionName,
  sessionVoiceName,
  sttDailyRule,
  sttIpName,
  sttSessionRule,
  viaLimiter,
  type LimitRule,
} from './limits';
import { clampLength, sanitizeText, singleLine } from './sanitize';
import { verifyTurnstile } from './turnstile';
import { sleep } from './util';
import { cleanToken, isValidSessionId } from './validation';

export const STT_MODEL = '@cf/openai/whisper-large-v3-turbo';

/** Largest recording accepted, in bytes (voice plan section 1.1). */
export const AUDIO_MAX_BYTES = 1_048_576;
// The multipart wrapper around the recording: boundaries, part headers, the session id and a Turnstile
// token (up to 2,048 characters). The body is cut off at the audio cap plus this; the recording itself
// is then held to exactly AUDIO_MAX_BYTES.
const FORM_OVERHEAD_BYTES = 16 * 1024;

/** The accepted recording labels. A label is compared case-insensitively, with any parameters (`;codecs=opus`) removed. */
export const AUDIO_TYPES: readonly string[] = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav'];

/** The longest utterance the widget records: the cap on the client's own figure (the real length is not capped). */
export const DURATION_MAX_MS = 20_000;
/** What a recording is assumed to last when the client did not say and the model does not report it. */
const DEFAULT_SECONDS = 10;
/**
 * The estimate's floor: an upload is taken to last at least its size divided by this, about 128 kbps. It
 * only matters when the model reports no length (or fails): a client cannot make a 1 MiB upload look
 * like one second. Compressed speech is really longer than this, and raw WAV shorter.
 */
const BYTES_PER_SECOND = 16_000;
const TEXT_MAX_CHARS = 1000;
const DEFAULT_RETRY_DELAY_MS = 400;

const badAudio = (): Response => json({ error: 'bad_audio' }, 400);
const rateLimited = (resetAt: number): Response =>
  json({ error: 'rate_limited' }, 429, { 'Retry-After': retryAfterSeconds(resetAt) });

interface SttRequest {
  sessionId: string;
  audio: Uint8Array;
  /** What the client claims the recording lasts, in milliseconds, capped at 20,000; undefined when it sent nothing usable. Only used for the fallback estimate. */
  durationMs: number | undefined;
  turnstileToken: string | undefined;
}

type Parsed = { ok: true; value: SttRequest } | { ok: false; response: Response };

/** A parse that ended in `response`: what the route answers instead of going on. */
const parseFailure = (response: Response): Parsed => ({ ok: false, response });

const mimeOf = (file: File): string => file.type.split(';')[0]!.trim().toLowerCase();

/** The client's duration in milliseconds, above 0 and at most 20,000 (more than that counts as 20,000), or undefined. */
const clientDuration = (raw: File | string | null): number | undefined => {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.min(ms, DURATION_MAX_MS);
};

/**
 * Reads the multipart body without ever holding more than the cap (see readBytes), then checks the
 * parts. Bad recordings are `bad_audio`; a bad session id is `bad_request`, as on /chat.
 */
const parse = async (request: Request): Promise<Parsed> => {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType)) return parseFailure(badAudio());

  const body = await readBytes(request, AUDIO_MAX_BYTES + FORM_OVERHEAD_BYTES);
  if (!body) return parseFailure(badAudio());

  let data: FormData;
  try {
    data = await new Response(body, { headers: { 'Content-Type': contentType } }).formData();
  } catch {
    return parseFailure(badAudio());
  }

  const audio = data.get('audio');
  if (typeof audio === 'string' || audio === null) return parseFailure(badAudio());
  if (audio.size === 0 || audio.size > AUDIO_MAX_BYTES || !AUDIO_TYPES.includes(mimeOf(audio))) return parseFailure(badAudio());

  const sessionId = data.get('sessionId');
  if (!isValidSessionId(sessionId)) return parseFailure(json({ error: 'bad_request' }, 400));

  return {
    ok: true,
    value: {
      sessionId,
      audio: new Uint8Array(await audio.arrayBuffer()),
      durationMs: clientDuration(data.get('durationMs')),
      turnstileToken: cleanToken(data.get('turnstileToken') ?? undefined),
    },
  };
};

/**
 * Base64 of a byte array. Buffer does it natively (nodejs_compat is on), which matters at a megabyte: a
 * character-by-character loop in JavaScript costs tens of milliseconds of the request's CPU time.
 */
const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');

interface Heard {
  text: string;
  /** Seconds, as the model measured the recording; undefined when it did not say (or said nonsense). */
  seconds: number | undefined;
}

/**
 * One Whisper call, abandoned (and its request aborted) after `timeoutMs`.
 *
 * `vad_filter` runs voice-activity detection first. Without it Whisper answers silence or room noise
 * with an invented "Thank you." (measured on the real binding, 2026-11-03), which would reach the chat
 * as the visitor's message; with it the transcript is "" and the widget shows its "didn't catch that"
 * copy. Short ("yes"), very quiet (-30 dB) and phone-number speech came back unchanged.
 */
const runWhisper = async (ai: Ai, audio: string, timeoutMs: number): Promise<Heard> => {
  const result = await withTimeout(timeoutMs, (signal) =>
    ai.run(STT_MODEL, { audio, task: 'transcribe', language: 'en', vad_filter: true }, { signal }),
  );
  if (typeof result?.text !== 'string') throw new Error('no transcript in the result');
  const seconds = result.transcription_info?.duration;
  return { text: result.text, seconds: typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : undefined };
};

/**
 * Whisper, with one retry after a failure that was not a timeout (a timeout already used the whole
 * 8 seconds, and the widget waits no longer than 20). Null when it did not work. Logs error names and
 * timings only.
 */
const transcribe = async (ai: Ai, audio: string, deps: VoiceDeps | undefined): Promise<Heard | null> => {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const started = Date.now();
    try {
      return await runWhisper(ai, audio, deps?.timeoutMs ?? AI_ATTEMPT_TIMEOUT_MS);
    } catch (error) {
      const retry = attempt === 1 && !(error instanceof AiTimeoutError);
      // The error's name only: its message can echo what was sent.
      console.error(
        JSON.stringify({ event: 'stt_error', ms: Date.now() - started, retry, error: (error as Error)?.name ?? 'Error' }),
      );
      if (!retry) return null;
      await sleep(deps?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    }
  }
  return null;
};

/**
 * The seconds to charge when the model did not report the recording's length (or never answered): the
 * client's figure (10 when it gave none), but never less than the upload's size implies.
 */
const estimateSeconds = (bytes: number, durationMs: number | undefined): number => {
  const claimed = durationMs === undefined ? DEFAULT_SECONDS : Math.ceil(durationMs / 1000);
  return Math.max(1, claimed, Math.ceil(bytes / BYTES_PER_SECOND));
};

/** What a visitor said, as a chat message would carry it: markup and control characters gone, one line, 1,000 characters. */
const cleanTranscript = (text: string): string => clampLength(singleLine(sanitizeText(text)), TEXT_MAX_CHARS).trim();

/**
 * POST /stt. Order: voice available -> read and check the upload (400s use up no allowance) -> session
 * read (ended? already at the 40 chat messages?) -> address limit (`ip:stt`) -> Turnstile -> are the
 * session's and the day's audio seconds already spent? -> Whisper -> charge what the audio really was. A
 * request refused at an earlier step never touches a later counter.
 *
 * A recording is not a chat message: it never adds to the session's 40-message count or to the chat
 * per-IP bucket (the transcript becomes one message when the widget sends it to /chat). It does not start
 * if the session has already used all 40, because /chat would refuse the transcript. Its own limits are
 * the address's 30 recordings per 10 minutes and the two audio-second budgets.
 *
 * The budgets are charged after the call, with the length the model measured, because the client's
 * `durationMs` is only a claim. The check before the call is "already at or over the cap"; a recording
 * that starts under the cap may take the counter past it, and the next one is refused.
 *
 * If the limiter itself is down no limit can be enforced, so no model call is made: 503, as /chat does.
 * Nothing about the recording or the transcript is logged: only sizes, seconds and timings.
 */
export const handleStt = async (request: Request, env: Env, deps: VoiceDeps | undefined): Promise<Response> => {
  const ai = env.AI;
  if (!ai) return unavailable('server');
  if (!isSttAvailable(env)) return unavailable('budget'); // a speech budget set to 0 is a budget that is spent

  const parsed = await parse(request);
  if (!parsed.ok) return parsed.response;
  return orLimiterDown(() => respond(request, env, ai, deps, parsed.value), () => unavailable('server'));
};

const respond = async (
  request: Request,
  env: Env,
  ai: Ai,
  deps: VoiceDeps | undefined,
  { sessionId, audio, durationMs, turnstileToken }: SttRequest,
): Promise<Response> => {
  const ip = request.headers.get('CF-Connecting-IP');

  // Read, not hit: this finds out whether /chat ended the session and how many chat messages it has had.
  const session = await viaLimiter(peekLimiter(env, sessionName(sessionId), CHAT_SESSION));
  if (session.ended) return json({ error: 'ended', reply: ENDED }, 403);
  if (session.count >= CHAT_SESSION.limit) return rateLimited(session.resetAt);

  const ipHit = await viaLimiter(hitLimiter(env, await sttIpName(ip ?? 'unknown', env.RATE_SALT), STT_IP));
  if (!ipHit.allowed) return rateLimited(ipHit.resetAt);

  // Either count trips the check, so a client cannot dodge Turnstile by minting new session ids:
  // the session's chat messages so far, or this address's recordings (this one included).
  if (Math.max(session.count, ipHit.count) > TURNSTILE_AFTER_MESSAGES) {
    if (!(await verifyTurnstile(turnstileToken, ip, turnstileSecret(env)))) {
      return json({ error: 'verification_required' }, 403);
    }
  }

  const sessionBudget = { name: sessionVoiceName(sessionId), rule: sttSessionRule(sessionVoiceSeconds(env)) };
  const dayBudget = { name: globalVoiceName(), rule: sttDailyRule(dailySttSeconds(env)) };
  const [sessionSpent, daySpent] = await Promise.all([
    viaLimiter(peekLimiter(env, sessionBudget.name, sessionBudget.rule)),
    viaLimiter(peekLimiter(env, dayBudget.name, dayBudget.rule)),
  ]);
  if (sessionSpent.count >= sessionBudget.rule.limit || daySpent.count >= dayBudget.rule.limit) return unavailable('budget');

  const started = Date.now();
  const heard = await transcribe(ai, toBase64(audio), deps);

  // What the audio really was, as the model measured it (not clamped: that is the point), else the estimate.
  const seconds = heard?.seconds === undefined ? estimateSeconds(audio.byteLength, durationMs) : Math.max(1, Math.ceil(heard.seconds));
  await charge(env, [sessionBudget, dayBudget], seconds);

  console.log(
    JSON.stringify({ event: 'stt', ms: Date.now() - started, status: heard ? 200 : 503, audioBytes: audio.byteLength, seconds }),
  );
  if (!heard) return unavailable('server');

  const text = cleanTranscript(heard.text);
  if (text === '') return json({ text: '' });
  const measuredMs = heard.seconds === undefined ? undefined : Math.round(heard.seconds * 1000);
  return json({ text, durationMs: durationMs === undefined ? (measuredMs ?? DEFAULT_SECONDS * 1000) : Math.round(durationMs) });
};

/**
 * Records `seconds` against each budget, after the fact. If the limiter fails here the transcript that
 * already exists is still returned, and the failure is logged: the check at the start of the next request
 * is what depends on this, and it fails closed on its own if the limiter stays down.
 */
const charge = async (env: Env, budgets: Array<{ name: string; rule: LimitRule }>, seconds: number): Promise<void> => {
  const results = await Promise.allSettled(
    budgets.map(async ({ name, rule }) => chargeLimiter(env, name, rule, seconds)),
  );
  if (results.some((result) => result.status === 'rejected')) console.error(JSON.stringify({ event: 'limiter_error' }));
};
