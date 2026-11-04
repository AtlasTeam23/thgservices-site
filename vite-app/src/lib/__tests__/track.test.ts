import { afterEach, describe, expect, it, vi } from 'vitest';

// track() is now a thin alias of analytics.trackEvent(): the concierge keeps
// its call sites, and brand merging, gating and logging live in one place.
describe('track (alias of trackEvent)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.doUnmock('../analytics');
    delete window.gtag;
    delete window.dataLayer;
  });

  it('forwards the name and params to trackEvent unchanged', async () => {
    const trackEvent = vi.fn();
    vi.doMock('../analytics', () => ({ trackEvent }));
    const { track } = await import('../track');
    track('concierge_open', { source: 'bubble' });
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith('concierge_open', { source: 'bubble' });
  });

  it('passes undefined params through when none are given', async () => {
    const trackEvent = vi.fn();
    vi.doMock('../analytics', () => ({ trackEvent }));
    const { track } = await import('../track');
    track('concierge_lead_form_shown');
    expect(trackEvent).toHaveBeenCalledWith('concierge_lead_form_shown', undefined);
  });

  it('does not throw and does not call a stray window.gtag while analytics is off', async () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { track } = await import('../track');
    expect(() => track('concierge_open', { source: 'bubble' })).not.toThrow();
    expect(gtag).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });

  it('adds the brand and logs "[analytics]" once analytics is on', async () => {
    vi.stubEnv('VITE_GA4_ID', 'G-TEST');
    vi.stubEnv('VITE_GA4_DEBUG', 'true');
    window.history.replaceState({}, '', '/?utm_campaign=sunshine');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { initAnalytics } = await import('../analytics');
    const { track } = await import('../track');
    initAnalytics();
    track('concierge_quick_reply', { chip: 'What do you do?' });
    const last = window.dataLayer?.at(-1);
    expect(Array.from(last as ArrayLike<unknown>)).toEqual([
      'event',
      'concierge_quick_reply',
      { chip: 'What do you do?', brand: 'sunshine' },
    ]);
    expect(debug).toHaveBeenCalledWith('[analytics]', 'concierge_quick_reply', {
      chip: 'What do you do?',
      brand: 'sunshine',
    });
    window.history.replaceState({}, '', '/');
    window.sessionStorage.clear();
  });
});
