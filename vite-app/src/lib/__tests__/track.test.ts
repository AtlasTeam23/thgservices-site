import { afterEach, describe, expect, it, vi } from 'vitest';
import { track } from '../track';

describe('track', () => {
  afterEach(() => {
    delete window.gtag;
    vi.restoreAllMocks();
  });

  it('calls window.gtag with the event name and params when gtag is defined', () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    track('concierge_open', { source: 'bubble' });
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith('event', 'concierge_open', {
      source: 'bubble',
    });
  });

  it('passes undefined params through when none are given', () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    track('concierge_lead_form_shown');
    expect(gtag).toHaveBeenCalledWith(
      'event',
      'concierge_lead_form_shown',
      undefined
    );
  });

  it('does not throw when gtag is undefined', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(window.gtag).toBeUndefined();
    expect(() => track('concierge_open', { source: 'bubble' })).not.toThrow();
  });

  it('does not throw when gtag itself throws', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    window.gtag = () => {
      throw new Error('blocked');
    };
    expect(() => track('concierge_open', { source: 'bubble' })).not.toThrow();
  });

  it('logs to console.debug in development builds', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(import.meta.env.DEV).toBe(true);
    track('concierge_quick_reply', { chip: 'What do you do?' });
    expect(debug).toHaveBeenCalledWith('[track]', 'concierge_quick_reply', {
      chip: 'What do you do?',
    });
  });
});
