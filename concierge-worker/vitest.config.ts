import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside the Workers runtime (workerd via Miniflare) with the real
// Durable Object binding. Bindings below override wrangler.jsonc vars so the
// suite is hermetic: mock LLM, no secrets, Turnstile's published test secret
// is passed per-test where needed. The `ai` binding in wrangler.jsonc is Workers AI, which only
// exists on Cloudflare's network: `remoteBindings: false` keeps the suite from opening a session on
// the logged-in account (and from needing a login, a network, or any neurons). Voice tests hand the
// Worker a stub binding through the env instead (see aiStub in test/helpers.ts).
export default defineConfig({
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          LLM_PROVIDER: 'mock',
          // Baseline: no paid voice. Voice tests switch a provider on per test; see testEnv() in test/helpers.ts.
          VOICE_TTS: 'browser',
          VOICE_ELEVEN_VOICE_ID: '',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
