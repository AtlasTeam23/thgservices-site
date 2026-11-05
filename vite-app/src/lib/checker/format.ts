/** The host to show in a message when the server did not give one. */
export function displayHost(input: string): string {
  const raw = input.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const host = raw.split(/[/?#]/)[0] ?? '';
  return host.replace(/^www\./i, '').slice(0, 80) || 'that site';
}

/** A quick shape check so an obvious typo never costs a scan. */
export function looksLikeSite(input: string): boolean {
  const v = input.trim();
  if (!v || v.length > 300 || /\s/.test(v)) return false;
  const host = displayHost(v);
  return /\.[a-z0-9-]{2,}$/i.test(host.split(':')[0] ?? '');
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'recently';
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** The address a report link points at: always the live site, never the current origin. */
export const REPORT_LINK_BASE = 'https://thgservices.io/website-checker/?r=';

export function reportLink(token: string): string {
  return `${REPORT_LINK_BASE}${encodeURIComponent(token)}`;
}
