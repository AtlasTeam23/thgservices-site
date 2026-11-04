// Thin analytics wrapper. GA4 is not installed on the site yet, so this calls
// window.gtag when it exists and otherwise does nothing. Never pass names,
// phone numbers, emails, or message text as params.

type TrackParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function track(name: string, params?: TrackParams): void {
  if (import.meta.env.DEV) {
    console.debug('[track]', name, params);
  }
  try {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
      window.gtag('event', name, params);
    }
  } catch {
    // Analytics must never break the UI.
  }
}
