import { handleChat } from './chat';
import { checkOrigin, originDenied, preflight, withCors } from './cors';
import { isEmailConfigured, isTurnstileConfigured, llmStatus, type Env } from './env';
import { json, methodNotAllowed } from './http';
import { handleLead, type LeadDeps } from './lead';
import type { GenerateDeps } from './llm';

export { Limiter } from './limiter';

/** Seams for tests (a stubbed model client, no retry delays). Production uses `{}`. */
export interface AppDeps {
  llm?: GenerateDeps;
  lead?: LeadDeps;
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
      });

    case '/chat':
      if (request.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
      return handleChat(request, env, deps.llm);

    case '/lead':
      if (request.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
      return handleLead(request, env, deps.lead);

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
