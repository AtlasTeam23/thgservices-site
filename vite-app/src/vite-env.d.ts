/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the concierge Worker, no trailing slash. Empty disables the real backend. */
  readonly VITE_CONCIERGE_API_URL?: string;
  /** Public Cloudflare Turnstile sitekey. Empty skips Turnstile. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
