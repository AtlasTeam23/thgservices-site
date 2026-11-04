// The only place that touches gtag. Everything here is a no-op unless
// isAnalyticsEnabled() is true. Never pass names, emails, phone numbers,
// message text or form values as params; the only free-text params are the
// static labels written in markup.

export type Params = Record<string, string | number | boolean>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const PLACEHOLDER_ID = 'G-XXXXXXX';
const BRAND_KEY = 'thg_brand';
const BRANDS = [
  'thg-ga',
  'thg-ct',
  'sunshine',
  'flooring-guys',
  'tile-guys',
  'cabinet-painting',
];
const OTHER = 'other';
const DIRECT = 'direct';

let initialized = false;
let loaded = false;
let brand = DIRECT;

function measurementId(): string {
  const id = (import.meta.env.VITE_GA4_ID ?? '').trim();
  return id && id !== PLACEHOLDER_ID ? id : '';
}

function debugOn(): boolean {
  return import.meta.env.VITE_GA4_DEBUG === 'true';
}

function dntOn(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  const win = window as Window & { doNotTrack?: string };
  return (
    navigator.doNotTrack === '1' ||
    win.doNotTrack === '1' ||
    nav.globalPrivacyControl === true
  );
}

export function isAnalyticsEnabled(): boolean {
  if (!measurementId()) return false;
  if (!import.meta.env.PROD && !debugOn()) return false;
  return !dntOn();
}

export function getBrand(): string {
  return brand;
}

function isKnownBrand(value: string | null): value is string {
  return value !== null && (BRANDS.includes(value) || value === OTHER || value === DIRECT);
}

function readStoredBrand(): string | null {
  try {
    const stored = window.sessionStorage.getItem(BRAND_KEY);
    return isKnownBrand(stored) ? stored : null;
  } catch {
    return null;
  }
}

function storeBrand(value: string): void {
  try {
    window.sessionStorage.setItem(BRAND_KEY, value);
  } catch {
    // Storage can be blocked; the in-memory brand still works for this load.
  }
}

// utm_campaign decides the brand: a known slug maps to itself, anything else
// that is present maps to "other", and absent falls back to the stored value
// from earlier in this session, then "direct". Only a slug from the allowlist
// is ever stored or sent, never the raw URL text.
function captureBrand(): void {
  let campaign = '';
  try {
    campaign = (new URLSearchParams(window.location.search).get('utm_campaign') ?? '')
      .trim()
      .toLowerCase();
  } catch {
    // Fall through to the stored value.
  }
  if (campaign) {
    brand = BRANDS.includes(campaign) ? campaign : OTHER;
    storeBrand(brand);
    return;
  }
  brand = readStoredBrand() ?? DIRECT;
  storeBrand(brand);
}

// Only these query keys ever reach GA4; everything else (an email, a name, a
// phone number someone put in a link) is dropped. The hash is never sent.
const KEPT_QUERY_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'gclid',
];
// Same cap as the concierge puts on the page URL it sends.
const MAX_QUERY_VALUE = 100;

// An allowlisted key can still carry something personal (an email pasted into
// utm_content, say), so a value with an "@" or over the cap is dropped, key and all.
// gclid is exempt from the cap only: real ones run 100+ characters, but it still
// loses to the "@" rule.
function isSafeQueryValue(key: string, value: string): boolean {
  if (value.includes('@')) return false;
  return key === 'gclid' || value.length <= MAX_QUERY_VALUE;
}

function cleanedQuery(): string {
  try {
    const kept = new URLSearchParams();
    new URLSearchParams(window.location.search).forEach((value, key) => {
      if (KEPT_QUERY_KEYS.includes(key) && isSafeQueryValue(key, value)) kept.append(key, value);
    });
    const query = kept.toString();
    return query ? `?${query}` : '';
  } catch {
    return '';
  }
}

// The only form of the page URL that GA4 ever sees: origin + path + the cleaned
// query, never the hash. gtag.js otherwise reports the raw location.href on every
// event, so this is also installed as the default page_location with `set`.
function cleanLocation(path: string): string {
  return `${window.location.origin}${path}${cleanedQuery()}`;
}

function loadGtag(id: string): void {
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  // gtag.js only understands `arguments` objects on the dataLayer, not arrays.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };

  window.gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  window.gtag('js', new Date());
  window.gtag('config', id, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    debug_mode: debugOn(),
  });
  // One `set`: the brand, and the cleaned URL so non-page_view events never
  // report the raw location.href (with its query and hash).
  window.gtag('set', { brand, page_location: cleanLocation(window.location.pathname) });
}

export function trackEvent(name: string, params?: Params): void {
  if (!loaded) return;
  try {
    const merged: Params = { ...params, brand };
    if (import.meta.env.DEV) console.debug('[analytics]', name, merged);
    window.gtag?.('event', name, merged);
  } catch {
    // Analytics must never break the UI.
  }
}

export function trackPageView(path: string): void {
  if (!loaded) return;
  const pageLocation = cleanLocation(path);
  try {
    // Keep the default page_location for later events in step with this page,
    // so a client-side navigation cannot bring the raw URL back.
    window.gtag?.('set', { page_location: pageLocation });
  } catch {
    // Analytics must never break the UI.
  }
  trackEvent('page_view', {
    page_path: path,
    page_location: pageLocation,
    page_title: document.title,
  });
}

// link_location: the nearest explicit data-analytics-location, else the id of
// the nearest section, else "footer" inside <footer>, else "page".
function linkLocation(el: Element): string {
  const tagged = el.closest('[data-analytics-location]')?.getAttribute('data-analytics-location');
  if (tagged) return tagged;
  const section = el.closest('section[id]');
  if (section) return section.id;
  if (el.closest('footer')) return 'footer';
  return 'page';
}

function onDocumentClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  // One click, one event: a phone or App Store link that is (or sits inside) a
  // data-cta-id element is reported as the phone/App Store click only.
  const phone = target.closest('a[href^="tel:"]');
  if (phone) {
    trackEvent('phone_call_click', { link_location: linkLocation(phone) });
    return;
  }

  const store = target.closest('a[href*="apps.apple.com"]');
  if (store) {
    trackEvent('app_store_click', { store: 'ios', link_location: linkLocation(store) });
    return;
  }

  const cta = target.closest('[data-cta-id]');
  const ctaId = cta?.getAttribute('data-cta-id');
  if (cta && ctaId) {
    trackEvent('cta_click', {
      cta_id: ctaId,
      // Static text written in markup, never the element's textContent.
      cta_label: cta.getAttribute('data-cta-label') ?? '',
      link_location: linkLocation(cta),
    });
  }
}

function loadBeacon(): void {
  const token = (import.meta.env.VITE_CF_BEACON_TOKEN ?? '').trim();
  if (!token) return;
  const script = document.createElement('script');
  script.defer = true;
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  script.setAttribute('data-cf-beacon', JSON.stringify({ token, spa: true }));
  document.head.appendChild(script);
}

export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;
  captureBrand();
  if (!isAnalyticsEnabled()) return;
  try {
    loadGtag(measurementId());
    loaded = true;
    // Capture phase so a stopPropagation() further down cannot hide a click.
    document.addEventListener('click', onDocumentClick, true);
    loadBeacon();
  } catch {
    // Analytics must never break the page.
  }
}
