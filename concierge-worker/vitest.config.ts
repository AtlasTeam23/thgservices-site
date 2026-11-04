import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside the Workers runtime (workerd via Miniflare) with the real
// Durable Object binding. Bindings below override wrangler.jsonc vars so the
// suite is hermetic: mock LLM, no secrets, Turnstile's published test secret
// is passed per-test where needed.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          LLM_PROVIDER: 'mock',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
