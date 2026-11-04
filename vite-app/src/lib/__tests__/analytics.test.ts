import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// analytics.ts keeps module-level state (initialised flag, brand, loaded flag),
// so every test gets a fresh copy of the module.
async function load() {
  vi.resetModules();
  return import('../analytics');
}

type Analytics = Awaited<ReturnType<typeof load>>;

// What gtag.js actually reads: the commands queued on window.dataLayer.
function queued(): unknown[][] {
  return (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
}

function scripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll('script'));
}

function gtagScript(): HTMLScriptElement | undefined {
  return scripts().find((s) => s.src.includes('googletagmanager.com'));
}

function beaconScript(): HTMLScriptElement | undefined {
  return scripts().find((s) => s.src.includes('cloudflareinsights.com'));
}

function setUrl(path: string) {
  window.history.replaceState({}, '', path);
}

// initAnalytics() puts one capture-phase click listener on document. Module
// resets would leave the old ones behind, so record and remove them.
const documentListeners: Array<
  [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]
> = [];
const realAddEventListener = document.addEventListener.bind(document);

function enable(overrides: { id?: string; debug?: string; prod?: boolean } = {}) {
  vi.stubEnv('VITE_GA4_ID', overrides.id ?? 'G-TEST');
  vi.stubEnv('VITE_GA4_DEBUG', overrides.debug ?? 'true');
  if (overrides.prod) {
    vi.stubEnv('PROD', true);
    vi.stubEnv('DEV', false);
  }
}

function setDnt(kind: 'navigator' | 'window' | 'gpc', value: unknown) {
  if (kind === 'navigator') {
    Object.defineProperty(navigator, 'doNotTrack', { value, configurable: true });
  } else if (kind === 'window') {
    Object.defineProperty(window, 'doNotTrack', { value, configurable: true });
  } else {
    Object.defineProperty(navigator, 'globalPrivacyControl', { value, configurable: true });
  }
}

beforeEach(() => {
  setUrl('/');
  window.sessionStorage.clear();
  delete window.dataLayer;
  delete window.gtag;
  document.head.querySelectorAll('script').forEach((s) => s.remove());
  vi.spyOn(document, 'addEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) => {
    documentListeners.push([type, listener, options]);
    realAddEventListener(type, listener, options);
  }) as typeof document.addEventListener);
});

afterEach(() => {
  for (const [type, listener, options] of documentListeners) {
    document.removeEventListener(type, listener, options);
  }
  documentListeners.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete (navigator as { doNotTrack?: unknown }).doNotTrack;
  delete (window as { doNotTrack?: unknown }).doNotTrack;
  delete (navigator as { globalPrivacyControl?: unknown }).globalPrivacyControl;
});

describe('A1: isAnalyticsEnabled', () => {
  it('is off when VITE_GA4_ID is unset or empty', async () => {
    vi.stubEnv('VITE_GA4_DEBUG', 'true');
    vi.stubEnv('VITE_GA4_ID', '');
    const { isAnalyticsEnabled } = await load();
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it('is off for the G-XXXXXXX placeholder, even in a production build', async () => {
    enable({ id: 'G-XXXXXXX', prod: true });
    const { isAnalyticsEnabled } = await load();
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it('is off in a dev build unless VITE_GA4_DEBUG is "true"', async () => {
    enable({ debug: '' });
    expect(import.meta.env.DEV).toBe(true);
    const { isAnalyticsEnabled } = await load();
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it('is on in a dev build with a real ID and VITE_GA4_DEBUG=true', async () => {
    enable();
    const { isAnalyticsEnabled } = await load();
    expect(isAnalyticsEnabled()).toBe(true);
  });

  it('is on in a production build with a real ID and no debug flag', async () => {
    enable({ debug: '', prod: true });
    const { isAnalyticsEnabled } = await load();
    expect(isAnalyticsEnabled()).toBe(true);
  });

  it('is off when navigator.doNotTrack is "1"', async () => {
    enable({ prod: true });
    setDnt('navigator', '1');
    const { isAnalyticsEnabled } = await load();
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it('is off when window.doNotTrack is "1"', async () => {
    enable({ prod: true });
    setDnt('window', '1');
    const { isAnalyticsEnabled } = await load();
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it('is off when navigator.globalPrivacyControl is true', async () => {
    enable({ prod: true });
    setDnt('gpc', true);
    const { isAnalyticsEnabled } = await load();
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it('stays on when the signals are present but not set ("0", false)', async () => {
    enable({ prod: true });
    setDnt('navigator', '0');
    setDnt('window', '0');
    setDnt('gpc', false);
    const { isAnalyticsEnabled } = await load();
    expect(isAnalyticsEnabled()).toBe(true);
  });
});

describe('A1: when analytics is disabled', () => {
  async function disabled(): Promise<Analytics> {
    vi.stubEnv('VITE_GA4_ID', 'G-XXXXXXX');
    vi.stubEnv('VITE_CF_BEACON_TOKEN', 'tok');
    return load();
  }

  it('creates no script tag and no dataLayer, and every export is a no-op', async () => {
    const a = await disabled();
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.initAnalytics();
    a.trackPageView('/');
    a.trackEvent('cta_click', { cta_id: 'x' });
    expect(scripts()).toHaveLength(0);
    expect(window.dataLayer).toBeUndefined();
    expect(window.gtag).toBeUndefined();
    expect(debug).not.toHaveBeenCalled();
  });

  it('adds no click listener', async () => {
    const a = await disabled();
    a.initAnalytics();
    expect(documentListeners.filter(([type]) => type === 'click')).toHaveLength(0);
  });

  it('still captures the brand so the concierge UTM data and brand agree', async () => {
    setUrl('/from-estimate?utm_campaign=sunshine');
    const a = await disabled();
    a.initAnalytics();
    expect(a.getBrand()).toBe('sunshine');
    expect(window.sessionStorage.getItem('thg_brand')).toBe('sunshine');
  });

  it('does not create a script tag under DNT either', async () => {
    enable({ prod: true });
    setDnt('navigator', '1');
    const a = await load();
    a.initAnalytics();
    expect(scripts()).toHaveLength(0);
    expect(window.dataLayer).toBeUndefined();
  });
});

describe('A1: brand capture', () => {
  it('is "direct" with no utm_campaign and nothing stored', async () => {
    const a = await load();
    a.initAnalytics();
    expect(a.getBrand()).toBe('direct');
  });

  it('is "direct" before initAnalytics() has run', async () => {
    setUrl('/?utm_campaign=thg-ga');
    const a = await load();
    expect(a.getBrand()).toBe('direct');
  });

  it.each(['thg-ga', 'thg-ct', 'sunshine', 'flooring-guys', 'tile-guys', 'cabinet-painting'])(
    'maps utm_campaign=%s to itself and stores it in sessionStorage',
    async (slug) => {
      setUrl(`/from-estimate?utm_source=leadquik&utm_campaign=${slug}`);
      const a = await load();
      a.initAnalytics();
      expect(a.getBrand()).toBe(slug);
      expect(window.sessionStorage.getItem('thg_brand')).toBe(slug);
    }
  );

  it('maps an unknown utm_campaign to "other"', async () => {
    setUrl('/?utm_campaign=spring-sale');
    const a = await load();
    a.initAnalytics();
    expect(a.getBrand()).toBe('other');
    expect(window.sessionStorage.getItem('thg_brand')).toBe('other');
  });

  it('matches the allowlist ignoring case and surrounding spaces', async () => {
    setUrl('/?utm_campaign=%20THG-GA%20');
    const a = await load();
    a.initAnalytics();
    expect(a.getBrand()).toBe('thg-ga');
  });

  it('treats an empty utm_campaign as absent', async () => {
    setUrl('/?utm_campaign=');
    const a = await load();
    a.initAnalytics();
    expect(a.getBrand()).toBe('direct');
  });

  it('never stores free text from the URL: a long or odd campaign collapses to "other"', async () => {
    setUrl('/?utm_campaign=jane.doe%40example.com');
    const a = await load();
    a.initAnalytics();
    expect(a.getBrand()).toBe('other');
    expect(window.sessionStorage.getItem('thg_brand')).toBe('other');
  });

  it('prefers the stored brand on a later load with no utm_campaign', async () => {
    window.sessionStorage.setItem('thg_brand', 'tile-guys');
    setUrl('/');
    const a = await load();
    a.initAnalytics();
    expect(a.getBrand()).toBe('tile-guys');
  });

  it('lets a new utm_campaign replace the stored brand', async () => {
    window.sessionStorage.setItem('thg_brand', 'tile-guys');
    setUrl('/?utm_campaign=sunshine');
    const a = await load();
    a.initAnalytics();
    expect(a.getBrand()).toBe('sunshine');
    expect(window.sessionStorage.getItem('thg_brand')).toBe('sunshine');
  });

  it('lets a new unknown utm_campaign replace the stored brand with "other"', async () => {
    window.sessionStorage.setItem('thg_brand', 'tile-guys');
    setUrl('/?utm_campaign=newsletter');
    const a = await load();
    a.initAnalytics();
    expect(a.getBrand()).toBe('other');
  });

  it('ignores a stored value that is not a known brand', async () => {
    window.sessionStorage.setItem('thg_brand', '<script>alert(1)</script>');
    const a = await load();
    a.initAnalytics();
    expect(a.getBrand()).toBe('direct');
  });

  it('does not throw and still reads the URL when sessionStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    setUrl('/?utm_campaign=flooring-guys');
    const a = await load();
    expect(() => a.initAnalytics()).not.toThrow();
    expect(a.getBrand()).toBe('flooring-guys');
  });

  it('falls back to "direct" when sessionStorage throws and there is no utm_campaign', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const a = await load();
    expect(() => a.initAnalytics()).not.toThrow();
    expect(a.getBrand()).toBe('direct');
  });

  it('is idempotent: a second initAnalytics() does not re-read the URL', async () => {
    setUrl('/?utm_campaign=thg-ct');
    const a = await load();
    a.initAnalytics();
    setUrl('/?utm_campaign=sunshine');
    a.initAnalytics();
    expect(a.getBrand()).toBe('thg-ct');
  });
});

describe('A2: loading gtag', () => {
  it('appends one async gtag.js script for the measurement ID', async () => {
    enable();
    const a = await load();
    a.initAnalytics();
    const found = scripts().filter((s) => s.src.includes('googletagmanager.com'));
    expect(found).toHaveLength(1);
    expect(found[0].src).toBe('https://www.googletagmanager.com/gtag/js?id=G-TEST');
    expect(found[0].async).toBe(true);
  });

  it('defines window.dataLayer and window.gtag', async () => {
    enable();
    const a = await load();
    a.initAnalytics();
    expect(Array.isArray(window.dataLayer)).toBe(true);
    expect(typeof window.gtag).toBe('function');
  });

  it('pushes the commands in order: consent, js, config, set brand', async () => {
    enable();
    setUrl('/from-estimate?utm_campaign=thg-ga');
    const a = await load();
    a.initAnalytics();
    const calls = queued();
    expect(calls).toHaveLength(4);
    expect(calls[0]).toEqual([
      'consent',
      'default',
      {
        analytics_storage: 'granted',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      },
    ]);
    expect(calls[1][0]).toBe('js');
    expect(calls[1][1]).toBeInstanceOf(Date);
    expect(calls[2]).toEqual([
      'config',
      'G-TEST',
      {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        debug_mode: true,
      },
    ]);
    // One `set` command, carrying the brand and the cleaned page URL.
    expect(calls[3]).toEqual([
      'set',
      { brand: 'thg-ga', page_location: `${window.location.origin}/from-estimate?utm_campaign=thg-ga` },
    ]);
    expect(calls.filter((c) => c[0] === 'set')).toHaveLength(1);
  });

  it('the init `set` page_location has no non-allowlisted query keys and no hash', async () => {
    enable();
    setUrl('/from-estimate?utm_campaign=thg-ga&email=jane%40x.com&name=Jane#contact');
    const a = await load();
    a.initAnalytics();
    const set = queued().find((c) => c[0] === 'set');
    expect(set?.[1]).toEqual({
      brand: 'thg-ga',
      page_location: `${window.location.origin}/from-estimate?utm_campaign=thg-ga`,
    });
    expect(JSON.stringify(queued())).not.toMatch(/email|jane|name=|#|contact/i);
  });

  it('queues Arguments objects, which is the shape gtag.js reads from dataLayer', async () => {
    enable();
    const a = await load();
    a.initAnalytics();
    expect(window.dataLayer?.length).toBeGreaterThan(0);
    for (const entry of window.dataLayer ?? []) {
      expect(Object.prototype.toString.call(entry)).toBe('[object Arguments]');
    }
  });

  it('sets debug_mode false on a production build without the debug flag', async () => {
    enable({ debug: '', prod: true });
    const a = await load();
    a.initAnalytics();
    expect(queued()[2][2]).toMatchObject({ debug_mode: false });
  });

  it('keeps an existing dataLayer and does not load twice', async () => {
    enable();
    window.dataLayer = [['existing']];
    const a = await load();
    a.initAnalytics();
    a.initAnalytics();
    expect(window.dataLayer[0]).toEqual(['existing']);
    expect(scripts().filter((s) => s.src.includes('googletagmanager.com'))).toHaveLength(1);
    expect(queued()).toHaveLength(5);
  });

  it('encodes the ID in the script URL', async () => {
    enable({ id: 'G-A&B=1' });
    const a = await load();
    a.initAnalytics();
    expect(gtagScript()?.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-A%26B%3D1');
  });

  it('adds one capture-phase click listener on document', async () => {
    enable();
    const a = await load();
    a.initAnalytics();
    a.initAnalytics();
    const clicks = documentListeners.filter(([type]) => type === 'click');
    expect(clicks).toHaveLength(1);
    expect(clicks[0][2]).toBe(true);
  });
});

describe('A3: trackPageView and trackEvent', () => {
  async function ready(): Promise<Analytics> {
    enable();
    const a = await load();
    a.initAnalytics();
    return a;
  }

  // The events pushed after the four init commands. (trackPageView also issues a
  // `set` just before its event; see commands() for those.)
  function sent(): unknown[][] {
    return queued().slice(4).filter((c) => c[0] === 'event');
  }

  // Every command pushed after the four init commands.
  function commands(): unknown[][] {
    return queued().slice(4);
  }

  it('trackPageView sends page_view with path, cleaned location, title and brand', async () => {
    setUrl('/from-estimate?utm_source=leadquik&utm_medium=estimate&utm_campaign=thg-ga&utm_content=TEST123');
    document.title = 'THG AI Services';
    const a = await ready();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.trackPageView('/from-estimate');
    expect(sent()).toEqual([
      [
        'event',
        'page_view',
        {
          page_path: '/from-estimate',
          page_location:
            `${window.location.origin}/from-estimate` +
            '?utm_source=leadquik&utm_medium=estimate&utm_campaign=thg-ga&utm_content=TEST123',
          page_title: 'THG AI Services',
          brand: 'thg-ga',
        },
      ],
    ]);
  });

  it('drops every query key except utm_* and gclid (no email, name, phone)', async () => {
    setUrl(
      '/from-estimate?email=jane%40example.com&name=Jane&phone=5551234567&utm_term=roof&gclid=abc123&utm_source=leadquik&foo=bar'
    );
    const a = await ready();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.trackPageView('/from-estimate');
    const params = sent()[0][2] as Record<string, string>;
    expect(params.page_location).toBe(
      `${window.location.origin}/from-estimate?utm_term=roof&gclid=abc123&utm_source=leadquik`
    );
    expect(JSON.stringify(sent())).not.toMatch(/jane|example\.com|5551234567|foo/i);
  });

  it('strips the hash and leaves no "?" when no allowed key is present', async () => {
    setUrl('/?email=a%40b.com#ai-concierge');
    const a = await ready();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.trackPageView('/');
    const params = sent()[0][2] as Record<string, string>;
    expect(params.page_location).toBe(`${window.location.origin}/`);
  });

  it('uses the path it is given for page_path and page_location', async () => {
    setUrl('/?utm_source=x');
    const a = await ready();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.trackPageView('/from-estimate');
    const params = sent()[0][2] as Record<string, string>;
    expect(params.page_path).toBe('/from-estimate');
    expect(params.page_location).toBe(`${window.location.origin}/from-estimate?utm_source=x`);
  });

  it('trackPageView re-issues `set page_location` right before the event, with the same cleaned URL', async () => {
    setUrl('/from-estimate?utm_campaign=thg-ga&email=jane%40x.com#contact');
    const a = await ready();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.trackPageView('/from-estimate');
    const cleaned = `${window.location.origin}/from-estimate?utm_campaign=thg-ga`;
    const cmds = commands();
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toEqual(['set', { page_location: cleaned }]);
    expect(cmds[1][0]).toBe('event');
    expect((cmds[1][2] as Record<string, string>).page_location).toBe(cleaned);
  });

  it('after a client-side navigation the next page_view sets the new, still-clean location', async () => {
    setUrl('/?utm_campaign=thg-ga');
    const a = await ready();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    setUrl('/from-estimate?utm_campaign=thg-ga&email=jane%40x.com#contact');
    a.trackPageView('/from-estimate');
    const sets = commands().filter((c) => c[0] === 'set');
    expect(sets).toEqual([
      ['set', { page_location: `${window.location.origin}/from-estimate?utm_campaign=thg-ga` }],
    ]);
  });

  it('trackEvent itself issues no `set` (it relies on the one from init or the last page view)', async () => {
    const a = await ready();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.trackEvent('concierge_lead');
    expect(commands().map((c) => c[0])).toEqual(['event']);
  });

  it('drops a utm_* value that contains "@" (an email in utm_content), key and value', async () => {
    setUrl(
      '/from-estimate?utm_source=leadquik&utm_content=jane%40example.com&utm_term=roof&utm_medium=a@b.co'
    );
    const a = await ready();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.trackPageView('/from-estimate');
    const params = sent()[0][2] as Record<string, string>;
    expect(params.page_location).toBe(
      `${window.location.origin}/from-estimate?utm_source=leadquik&utm_term=roof`
    );
    // Neither the init `set`, the page-view `set` nor the event carries it.
    expect(JSON.stringify(queued())).not.toMatch(/jane|example\.com|a@b|%40|@/);
  });

  it('keeps a utm_* value of exactly 100 characters and drops one of 101', async () => {
    const ok = 'a'.repeat(100);
    const tooLong = 'b'.repeat(101);
    setUrl(`/from-estimate?utm_content=${ok}&utm_term=${tooLong}&utm_source=leadquik`);
    const a = await ready();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.trackPageView('/from-estimate');
    const params = sent()[0][2] as Record<string, string>;
    expect(params.page_location).toBe(
      `${window.location.origin}/from-estimate?utm_content=${ok}&utm_source=leadquik`
    );
    expect(JSON.stringify(queued())).not.toContain(tooLong);
  });

  it('keeps a long gclid (real ones run 100+ characters): the length cap does not apply to it', async () => {
    const gclid = 'c'.repeat(120);
    setUrl(`/from-estimate?gclid=${gclid}&utm_source=x`);
    const a = await ready();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.trackPageView('/from-estimate');
    expect((sent()[0][2] as Record<string, string>).page_location).toBe(
      `${window.location.origin}/from-estimate?gclid=${gclid}&utm_source=x`
    );
  });

  it('still drops a gclid that contains "@"', async () => {
    setUrl('/from-estimate?gclid=jane%40x.com&utm_source=x');
    const a = await ready();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.trackPageView('/from-estimate');
    expect((sent()[0][2] as Record<string, string>).page_location).toBe(
      `${window.location.origin}/from-estimate?utm_source=x`
    );
    expect(JSON.stringify(queued())).not.toMatch(/jane|@/);
  });

  it('trackEvent merges the brand into the params', async () => {
    setUrl('/?utm_campaign=sunshine');
    const a = await ready();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.trackEvent('phone_call_click', { link_location: 'about' });
    expect(sent()).toEqual([
      ['event', 'phone_call_click', { link_location: 'about', brand: 'sunshine' }],
    ]);
  });

  it('trackEvent sends just the brand when there are no params', async () => {
    const a = await ready();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.trackEvent('concierge_lead');
    expect(sent()).toEqual([['event', 'concierge_lead', { brand: 'direct' }]]);
  });

  it('a caller cannot override the brand', async () => {
    setUrl('/?utm_campaign=tile-guys');
    const a = await ready();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.trackEvent('cta_click', { brand: 'spoofed' });
    expect((sent()[0][2] as Record<string, unknown>).brand).toBe('tile-guys');
  });

  it('does not mutate the params object it was given', async () => {
    const a = await ready();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const params = { link_location: 'hero' };
    a.trackEvent('cta_click', params);
    expect(params).toEqual({ link_location: 'hero' });
  });

  it('logs "[analytics]", the name and the merged params with console.debug in dev', async () => {
    setUrl('/?utm_campaign=thg-ga');
    const a = await ready();
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(import.meta.env.DEV).toBe(true);
    a.trackEvent('phone_call_click', { link_location: 'about' });
    expect(debug).toHaveBeenCalledWith('[analytics]', 'phone_call_click', {
      link_location: 'about',
      brand: 'thg-ga',
    });
  });

  it('logs page views in dev too, with the brand and cleaned location', async () => {
    setUrl('/from-estimate?utm_campaign=thg-ga&email=a%40b.com');
    const a = await ready();
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.trackPageView('/from-estimate');
    expect(debug).toHaveBeenCalledWith(
      '[analytics]',
      'page_view',
      expect.objectContaining({
        brand: 'thg-ga',
        page_location: `${window.location.origin}/from-estimate?utm_campaign=thg-ga`,
      })
    );
  });

  it('does not log in a production build', async () => {
    enable({ debug: '', prod: true });
    const a = await load();
    a.initAnalytics();
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.trackEvent('cta_click', { cta_id: 'x' });
    expect(debug).not.toHaveBeenCalled();
    expect(sent()).toHaveLength(1);
  });

  it('is a no-op before initAnalytics() has run', async () => {
    enable();
    const a = await load();
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.trackEvent('cta_click', { cta_id: 'x' });
    a.trackPageView('/');
    expect(window.dataLayer).toBeUndefined();
    expect(debug).not.toHaveBeenCalled();
  });

  it('swallows an error thrown by gtag', async () => {
    const a = await ready();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    window.gtag = () => {
      throw new Error('blocked');
    };
    expect(() => a.trackEvent('cta_click', { cta_id: 'x' })).not.toThrow();
    expect(() => a.trackPageView('/')).not.toThrow();
  });
});

describe('A4: delegated click events', () => {
  async function ready(): Promise<Analytics> {
    enable();
    const a = await load();
    a.initAnalytics();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    return a;
  }

  function sent(): unknown[][] {
    return queued().slice(4);
  }

  function click(el: Element) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  function mount(html: string) {
    document.body.innerHTML = html;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('a tel link inside section#about is a phone_call_click with link_location "about"', async () => {
    setUrl('/?utm_campaign=thg-ga');
    await ready();
    mount('<section id="about"><a id="t" href="tel:+18665197993">+1 (866) 519-7993</a></section>');
    click(document.getElementById('t')!);
    expect(sent()).toEqual([
      ['event', 'phone_call_click', { link_location: 'about', brand: 'thg-ga' }],
    ]);
  });

  it('never puts the phone number into the event', async () => {
    await ready();
    mount('<section id="about"><a id="t" href="tel:+18665197993">+1 (866) 519-7993</a></section>');
    click(document.getElementById('t')!);
    // Exactly one event, so the scan below is not passing on an empty list.
    expect(sent()).toHaveLength(1);
    expect(JSON.stringify(sent())).not.toMatch(/8665197993|866/);
  });

  it('an App Store link inside the Work card is an app_store_click even when the card stops propagation', async () => {
    await ready();
    // Built with the DOM API: the HTML parser would split an <a> nested in an <a>,
    // but React happily produces exactly this for the Work card.
    mount('<section id="products"></section>');
    const card = document.createElement('a');
    card.href = 'https://leadquik.com';
    const store = document.createElement('a');
    store.id = 'store';
    store.href = 'https://apps.apple.com/app/leadquik-leads-jobs-crm/id6797596704';
    card.appendChild(store);
    document.getElementById('products')!.appendChild(card);
    // Same as Work.tsx: the link stops the click from reaching the card. (preventDefault
    // is only here because the stop also keeps jsdom's test-setup handler from seeing it,
    // and jsdom cannot navigate.)
    store.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    click(document.getElementById('store')!);
    expect(sent()).toEqual([
      ['event', 'app_store_click', { store: 'ios', link_location: 'products', brand: 'direct' }],
    ]);
  });

  it('tracks an App Store badge image click through its link', async () => {
    await ready();
    mount(`
      <section id="bella-beast">
        <a href="https://apps.apple.com/us/app/bella-beast/id6825593814"><img id="img" alt="Download on the App Store" /></a>
      </section>`);
    click(document.getElementById('img')!);
    expect(sent()).toEqual([
      ['event', 'app_store_click', { store: 'ios', link_location: 'bella-beast', brand: 'direct' }],
    ]);
  });

  it('a data-cta-id button in section#hero is a cta_click whose label comes from the attribute', async () => {
    setUrl('/?utm_campaign=sunshine');
    await ready();
    mount(`
      <section id="hero">
        <a id="c" href="#products" data-cta-id="hero_products" data-cta-label="Our products">Visible text that must not be sent →</a>
      </section>`);
    click(document.getElementById('c')!);
    expect(sent()).toEqual([
      [
        'event',
        'cta_click',
        { cta_id: 'hero_products', cta_label: 'Our products', link_location: 'hero', brand: 'sunshine' },
      ],
    ]);
    expect(JSON.stringify(sent())).not.toContain('Visible text');
  });

  it('finds the data-cta-id element when a child inside it is clicked', async () => {
    await ready();
    mount(`
      <section id="consulting">
        <button id="c" data-cta-id="consulting_book" data-cta-label="Book a Conversation"><span id="inner">Book</span></button>
      </section>`);
    click(document.getElementById('inner')!);
    expect(sent()).toHaveLength(1);
    expect(sent()[0][1]).toBe('cta_click');
    expect(sent()[0][2]).toMatchObject({ cta_id: 'consulting_book', link_location: 'consulting' });
  });

  it('a tel link inside [data-analytics-location="concierge"] reports "concierge"', async () => {
    await ready();
    mount('<div data-analytics-location="concierge"><a id="t" href="tel:+18665197993">Call</a></div>');
    click(document.getElementById('t')!);
    expect(sent()).toEqual([
      ['event', 'phone_call_click', { link_location: 'concierge', brand: 'direct' }],
    ]);
  });

  it('data-analytics-location wins over an enclosing section id', async () => {
    await ready();
    mount(
      '<section id="ai-concierge"><div data-analytics-location="concierge"><a id="t" href="tel:+18665197993">Call</a></div></section>'
    );
    click(document.getElementById('t')!);
    expect((sent()[0][2] as Record<string, string>).link_location).toBe('concierge');
  });

  it('uses the nearest section[id], ignoring a section without an id', async () => {
    await ready();
    mount(
      '<section id="about"><section><a id="t" href="tel:+18665197993">Call</a></section></section>'
    );
    click(document.getElementById('t')!);
    expect((sent()[0][2] as Record<string, string>).link_location).toBe('about');
  });

  it('reports "footer" inside <footer> and "page" everywhere else', async () => {
    await ready();
    mount(`
      <footer><a id="f" href="tel:+18665197993">Call</a></footer>
      <a id="p" href="tel:+18665197993">Call</a>`);
    click(document.getElementById('f')!);
    click(document.getElementById('p')!);
    expect(sent().map((c) => (c[2] as Record<string, string>).link_location)).toEqual([
      'footer',
      'page',
    ]);
  });

  it('ignores clicks on anything else', async () => {
    await ready();
    mount(`
      <section id="about">
        <a id="a" href="https://leadquik.com">LeadQuik</a>
        <a id="m" href="mailto:developer@leadquik.com">Email</a>
        <button id="b">Plain</button>
      </section>`);
    click(document.getElementById('a')!);
    click(document.getElementById('m')!);
    click(document.getElementById('b')!);
    click(document.body);
    expect(sent()).toEqual([]);
  });

  it('ignores a data-cta-id that is empty', async () => {
    await ready();
    mount('<section id="hero"><a id="c" href="#x" data-cta-id="" data-cta-label="x">x</a></section>');
    click(document.getElementById('c')!);
    expect(sent()).toEqual([]);
  });

  it('sends an empty cta_label rather than the element text when data-cta-label is missing', async () => {
    await ready();
    mount('<section id="hero"><a id="c" href="#x" data-cta-id="hero_products">Our products</a></section>');
    click(document.getElementById('c')!);
    expect(sent()[0][2]).toMatchObject({ cta_id: 'hero_products', cta_label: '' });
  });

  it('a tel link that is also a data-cta-id element fires only phone_call_click', async () => {
    await ready();
    mount(
      '<section id="ai-concierge"><a id="t" href="tel:+18665197993" data-cta-id="x" data-cta-label="Call">Call</a></section>'
    );
    click(document.getElementById('t')!);
    expect(sent()).toEqual([
      ['event', 'phone_call_click', { link_location: 'ai-concierge', brand: 'direct' }],
    ]);
  });

  it('a tel link inside a data-cta-id element fires only phone_call_click', async () => {
    await ready();
    mount(
      '<section id="hero"><div data-cta-id="card" data-cta-label="Card"><a id="t" href="tel:+18665197993"><span id="inner">Call</span></a></div></section>'
    );
    click(document.getElementById('inner')!);
    expect(sent()).toEqual([
      ['event', 'phone_call_click', { link_location: 'hero', brand: 'direct' }],
    ]);
  });

  it('an App Store link that is, or sits inside, a data-cta-id element fires only app_store_click', async () => {
    await ready();
    mount(`
      <section id="products">
        <a id="own" href="https://apps.apple.com/app/x/id1" data-cta-id="a" data-cta-label="A">Store</a>
        <div data-cta-id="b" data-cta-label="B"><a id="nested" href="https://apps.apple.com/app/x/id2">Store</a></div>
      </section>`);
    click(document.getElementById('own')!);
    click(document.getElementById('nested')!);
    expect(sent()).toEqual([
      ['event', 'app_store_click', { store: 'ios', link_location: 'products', brand: 'direct' }],
      ['event', 'app_store_click', { store: 'ios', link_location: 'products', brand: 'direct' }],
    ]);
  });

  it('a cta_click fired on a URL with an email and a hash is preceded by a clean `set page_location`', async () => {
    setUrl('/from-estimate?utm_campaign=thg-ga&email=jane@x.com#contact');
    await ready();
    mount(
      '<section id="hero"><a id="c" href="#products" data-cta-id="hero_products" data-cta-label="Our products">x</a></section>'
    );
    click(document.getElementById('c')!);

    const all = queued();
    const at = all.findIndex((c) => c[0] === 'event' && c[1] === 'cta_click');
    expect(at).toBeGreaterThan(-1);
    const sets = all.slice(0, at).filter((c) => c[0] === 'set');
    const lastSet = sets.at(-1);
    const pageLocation = (lastSet?.[1] as Record<string, string>).page_location;
    expect(pageLocation).toBe(`${window.location.origin}/from-estimate?utm_campaign=thg-ga`);
    expect(pageLocation).not.toMatch(/email|jane|#/);
    // And nothing anywhere in the queue carries the raw URL.
    expect(JSON.stringify(all)).not.toMatch(/email|jane|#contact/);
  });

  it('counts one click once', async () => {
    await ready();
    mount('<section id="about"><a id="t" href="tel:+18665197993">Call</a></section>');
    click(document.getElementById('t')!);
    expect(sent()).toHaveLength(1);
  });
});

describe('A5: Cloudflare Web Analytics beacon', () => {
  it('is appended when analytics is enabled and a token is set, with the exact JSON attribute', async () => {
    enable();
    vi.stubEnv('VITE_CF_BEACON_TOKEN', 'abc123token');
    const a = await load();
    a.initAnalytics();
    const found = scripts().filter((s) => s.src.includes('cloudflareinsights.com'));
    expect(found).toHaveLength(1);
    expect(found[0].src).toBe('https://static.cloudflareinsights.com/beacon.min.js');
    expect(found[0].defer).toBe(true);
    expect(found[0].getAttribute('data-cf-beacon')).toBe('{"token":"abc123token","spa":true}');
  });

  it('is not appended when the token is empty or unset', async () => {
    enable();
    vi.stubEnv('VITE_CF_BEACON_TOKEN', '');
    const a = await load();
    a.initAnalytics();
    expect(beaconScript()).toBeUndefined();
    expect(gtagScript()).toBeDefined();
  });

  it('is not appended when the token is only whitespace', async () => {
    enable();
    vi.stubEnv('VITE_CF_BEACON_TOKEN', '   ');
    const a = await load();
    a.initAnalytics();
    expect(beaconScript()).toBeUndefined();
  });

  it('is not appended when analytics is off (placeholder ID), even with a token', async () => {
    enable({ id: 'G-XXXXXXX' });
    vi.stubEnv('VITE_CF_BEACON_TOKEN', 'abc123token');
    const a = await load();
    a.initAnalytics();
    expect(beaconScript()).toBeUndefined();
    expect(scripts()).toHaveLength(0);
  });

  it('is not appended in a dev build without the debug flag', async () => {
    enable({ debug: '' });
    vi.stubEnv('VITE_CF_BEACON_TOKEN', 'abc123token');
    const a = await load();
    a.initAnalytics();
    expect(scripts()).toHaveLength(0);
  });

  it.each([
    ['navigator.doNotTrack', 'navigator', '1'],
    ['window.doNotTrack', 'window', '1'],
    ['Global Privacy Control', 'gpc', true],
  ] as const)('is blocked by %s', async (_label, kind, value) => {
    enable({ prod: true });
    vi.stubEnv('VITE_CF_BEACON_TOKEN', 'abc123token');
    setDnt(kind, value);
    const a = await load();
    a.initAnalytics();
    expect(beaconScript()).toBeUndefined();
    expect(scripts()).toHaveLength(0);
  });

  it('is appended once even if initAnalytics() is called twice', async () => {
    enable();
    vi.stubEnv('VITE_CF_BEACON_TOKEN', 'abc123token');
    const a = await load();
    a.initAnalytics();
    a.initAnalytics();
    expect(scripts().filter((s) => s.src.includes('cloudflareinsights.com'))).toHaveLength(1);
  });

  it('keeps the token out of the attribute as raw HTML: it is JSON-encoded', async () => {
    enable();
    vi.stubEnv('VITE_CF_BEACON_TOKEN', 'a"b');
    const a = await load();
    a.initAnalytics();
    const attr = beaconScript()?.getAttribute('data-cf-beacon');
    expect(JSON.parse(attr ?? '{}')).toEqual({ token: 'a"b', spa: true });
  });
});
