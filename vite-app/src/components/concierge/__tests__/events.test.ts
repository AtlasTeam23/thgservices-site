import { describe, expect, it, vi } from 'vitest';
import {
  CONCIERGE_OPEN_EVENT,
  onConciergeOpen,
  openConcierge,
  type OpenDetail,
} from '../events';

describe('concierge events', () => {
  it('uses the documented event name', () => {
    expect(CONCIERGE_OPEN_EVENT).toBe('thg:concierge:open');
  });

  it('openConcierge dispatches a CustomEvent on window with its detail', () => {
    const listener = vi.fn();
    window.addEventListener('thg:concierge:open', listener);
    openConcierge({ source: 'section_cta', quickReply: 'Try the AI Concierge' });
    window.removeEventListener('thg:concierge:open', listener);

    expect(listener).toHaveBeenCalledTimes(1);
    const evt = listener.mock.calls[0][0] as CustomEvent<OpenDetail>;
    expect(evt).toBeInstanceOf(CustomEvent);
    expect(evt.detail).toEqual({
      source: 'section_cta',
      quickReply: 'Try the AI Concierge',
    });
  });

  it('onConciergeOpen delivers the detail and returns an unsubscribe function', () => {
    const handler = vi.fn();
    const off = onConciergeOpen(handler);
    openConcierge({ source: 'bubble' });
    expect(handler).toHaveBeenCalledWith({ source: 'bubble' });
    off();
    openConcierge({ source: 'bubble' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('onConciergeOpen drops a quickReply that is not one of the widget\'s own chips', () => {
    const handler = vi.fn();
    const off = onConciergeOpen(handler);
    openConcierge({ source: 'section_cta', quickReply: 'my phone is 555-0100' });
    openConcierge({ source: 'section_cta', quickReply: 'Yes, call me' });
    off();
    expect(handler).toHaveBeenNthCalledWith(1, { source: 'section_cta' });
    expect(handler).toHaveBeenNthCalledWith(2, { source: 'section_cta', quickReply: 'Yes, call me' });
  });

  it('onConciergeOpen falls back to the bubble source on malformed events', () => {
    const handler = vi.fn();
    const off = onConciergeOpen(handler);
    window.dispatchEvent(new CustomEvent('thg:concierge:open'));
    off();
    expect(handler).toHaveBeenCalledWith({ source: 'bubble' });
  });
});
