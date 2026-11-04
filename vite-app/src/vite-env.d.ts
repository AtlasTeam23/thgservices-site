/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the concierge Worker, no trailing slash. Empty disables the real backend. */
  readonly VITE_CONCIERGE_API_URL?: string;
  /** Public Cloudflare Turnstile sitekey. Empty skips Turnstile. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  /** GA4 Measurement ID (G-...). Empty or the G-XXXXXXX placeholder means analytics is off. */
  readonly VITE_GA4_ID?: string;
  /** "true" sends debug_mode and lets analytics load outside production builds. */
  readonly VITE_GA4_DEBUG?: string;
  /** Cloudflare Web Analytics beacon token. Empty disables the beacon. */
  readonly VITE_CF_BEACON_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
