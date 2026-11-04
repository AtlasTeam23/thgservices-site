import type { VoiceDeps } from './ai';
import { handleChat } from './chat';
import { checkOrigin, originDenied, preflight, withCors } from './cors';
import { isAuraAvailable, isEmailConfigured, isSttAvailable, isTurnstileConfigured, llmStatus, ttsMode, type Env } from './env';
import { json, methodNotAllowed } from './http';
import { handleLead, type LeadDeps } from './lead';
import type { GenerateDeps } from './llm';
import { handleStt } from './stt';
import { handleTts } from './tts';

export { Limiter } from './limiter';

/** Seams for tests (a stubbed model client, no retry delays). Production uses `{}`. */
export interface AppDeps {
  llm?: GenerateDeps;
  lead?: LeadDeps;
  voice?: VoiceDeps;
}

const route = async (request: Request, env: Env, deps: AppDeps): Promise<Response> => {
  const { pathname } = new URL(request.url);

  switch (pathname) {
    case '/health':
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return json({
        ok: true,
        llm: llmStatus(env),
        email: isEmailConfigured(env),
        turnstile: isTurnstileConfigured(env),
        voice: { stt: isSttAvailable(env), tts: isAuraAvailable(env) ? 'aura' : 'browser' },
      });

    case '/chat':
      if (request.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
      return handleChat(request, env, deps.llm);

    case '/lead':
      if (request.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
      return handleLead(request, env, deps.lead);

    case '/stt':
      if (request.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
      return handleStt(request, env, deps.voice);

    case '/tts':
      // The premium voice is off unless VOICE_TTS=aura, and then the route does not exist at all.
      if (ttsMode(env) !== 'aura') return json({ error: 'not_found' }, 404);
      if (request.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
      return handleTts(request, env, deps.voice);

    default:
      return json({ error: 'not_found' }, 404);
  }
};

export const createApp = (deps: AppDeps = {}) => ({
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const origin = checkOrigin(request, env);
    if (origin.status === 'denied') return originDenied();
    if (request.method === 'OPTIONS') return preflight(origin);

    try {
      return withCors(await route(request, env, deps), origin);
    } catch (error) {
      // Log the error type only: messages can echo request data.
      console.error(JSON.stringify({ event: 'unhandled', error: (error as Error)?.name ?? 'Error' }));
      return withCors(json({ error: 'internal' }, 500), origin);
    }
  },
} satisfies ExportedHandler<Env>);

export default createApp();
