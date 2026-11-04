// Build-time configuration, read at call time so tests can stub it.

/** Base URL of the concierge Worker, without a trailing slash. */
export const apiBase = (): string =>
  (import.meta.env.VITE_CONCIERGE_API_URL ?? '').trim().replace(/\/+$/, '');

/**
 * A production build with no Worker URL has nothing to talk to, so the widget
 * stays out of the page. Development keeps it on (it then shows its offline
 * fallback) so the layout can be worked on without the Worker running.
 */
export const isConciergeEnabled = (): boolean => !import.meta.env.PROD || apiBase().length > 0;
