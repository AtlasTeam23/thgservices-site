import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => ({ postChat: vi.fn(), postLead: vi.fn() }));
vi.mock('../turnstile', () => ({ getToken: vi.fn() }));

import { Concierge } from '../index';
import { initAnalytics } from '../../../lib/analytics';
import { postChat } from '../api';
import * as copy from '../copy';

// The real track() -> trackEvent() chain, observed where gtag.js would see it.
function sent(): unknown[][] {
  return (window.dataLayer ?? [])
    .map((entry) => Array.from(entry as ArrayLike<unknown>))
    .filter((call) => call[0] === 'event');
}

beforeAll(() => {
  vi.stubEnv('VITE_GA4_ID', 'G-TEST');
  vi.stubEnv('VITE_GA4_DEBUG', 'true');
  window.history.replaceState({}, '', '/?utm_campaign=tile-guys');
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  initAnalytics();
});

afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  window.history.replaceState({}, '', '/');
  window.sessionStorage.clear();
});

beforeEach(() => {
  window.dataLayer?.splice(0, window.dataLayer.length);
  vi.mocked(postChat).mockResolvedValue({
    kind: 'ok',
    data: { reply: 'Here to help.', intent: 'answer', offerCallback: false },
  });
});

describe('concierge analytics location', () => {
  it('marks the bubble root as the concierge', () => {
    const { container } = render(<Concierge />);
    expect(container.querySelector('.thg-cc-root')).toHaveAttribute(
      'data-analytics-location',
      'concierge'
    );
  });

  it('marks the open chat panel as the concierge', async () => {
    const user = userEvent.setup();
    render(<Concierge />);
    await user.click(screen.getByRole('button', { name: copy.BUBBLE_LABEL }));
    const dialog = await screen.findByRole('dialog', { name: copy.PANEL_TITLE });
    expect(dialog).toHaveAttribute('data-analytics-location', 'concierge');
  });

  it('reports a tap on the panel phone link as phone_call_click from "concierge", plus the existing sub-signal', async () => {
    const user = userEvent.setup();
    render(<Concierge />);
    await user.click(screen.getByRole('button', { name: copy.BUBBLE_LABEL }));
    const dialog = await screen.findByRole('dialog', { name: copy.PANEL_TITLE });
    window.dataLayer?.splice(0, window.dataLayer.length);

    const call = Array.from(dialog.querySelectorAll<HTMLAnchorElement>('a[href^="tel:"]')).find(
      (a) => !a.hidden
    );
    expect(call).toBeDefined();
    await user.click(call!);

    expect(sent()).toEqual(
      expect.arrayContaining([
        ['event', 'phone_call_click', { link_location: 'concierge', brand: 'tile-guys' }],
        ['event', 'concierge_call_click', { location: 'panel', brand: 'tile-guys' }],
      ])
    );
    expect(JSON.stringify(sent())).not.toMatch(/\d{3}[-.\s)]*\d{4}/);
  });

  it('adds the brand to the existing concierge_open event', async () => {
    const user = userEvent.setup();
    render(<Concierge />);
    await user.click(screen.getByRole('button', { name: copy.BUBBLE_LABEL }));
    await screen.findByRole('dialog');
    expect(sent()).toContainEqual([
      'event',
      'concierge_open',
      { source: 'bubble', brand: 'tile-guys' },
    ]);
  });
});
