import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/track', () => ({ track: vi.fn() }));

import AiConcierge from '../AiConcierge';
import { track } from '../../lib/track';
import { CONCIERGE_OPEN_EVENT, type OpenDetail } from '../../components/concierge/events';

describe('AiConcierge section', () => {
  // jsdom has no scrollIntoView; tests install a spy and must put things back.
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
    } else {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it('is the #ai-concierge section with the agreed copy', () => {
    const { container } = render(<AiConcierge />);
    const section = container.querySelector('section#ai-concierge');
    expect(section).not.toBeNull();
    expect(screen.getByText('AI Website Concierge', { selector: 'span.font-mono-label' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'An AI helper that answers your website 24/7' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your customers have questions at 9 PM and on Sundays. Our AI Website Concierge is a friendly chat helper on your website that answers common questions, takes down their name and number, and sets up a callback — so you don't lose the job and you don't have to be glued to your phone. More time for your family, fewer missed leads."
      )
    ).toBeInTheDocument();
    const bullets = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(bullets).toEqual([
      'Answers questions about your business, day or night',
      'Collects name, phone, and what they need',
      'Sets up callbacks so your team follows up',
    ]);
    expect(
      screen.getByText(
        'Proudly based in Woodstock, GA, helping local businesses across Cherokee County and metro Atlanta.'
      )
    ).toBeInTheDocument();
  });

  it('states no prices, statistics or testimonials', () => {
    const { container } = render(<AiConcierge />);
    const text = container.textContent ?? '';
    // The only digits are the phone number and the "9 PM" / "24/7" in the agreed copy.
    expect(text).not.toMatch(/\$/);
    expect(text).not.toMatch(/%/);
  });

  it('"Try it now" asks the concierge to open and run the Try the AI Concierge chip', async () => {
    const user = userEvent.setup();
    const seen: OpenDetail[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent<OpenDetail>).detail);
    window.addEventListener(CONCIERGE_OPEN_EVENT, listener);
    render(<AiConcierge />);
    await user.click(screen.getByRole('button', { name: 'Try it now' }));
    window.removeEventListener(CONCIERGE_OPEN_EVENT, listener);
    expect(seen).toEqual([{ source: 'section_cta', quickReply: 'Try the AI Concierge' }]);
  });

  it('leaves out the Try it now button when the chat helper is switched off, keeping the phone link', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_CONCIERGE_API_URL', '');
    render(<AiConcierge />);
    expect(screen.queryByRole('button', { name: 'Try it now' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call (866) 519-7993' })).toBeInTheDocument();
  });

  it('has a phone link that tracks a section call click', async () => {
    const user = userEvent.setup();
    render(<AiConcierge />);
    const call = screen.getByRole('link', { name: 'Call (866) 519-7993' });
    expect(call).toHaveAttribute('href', 'tel:+18665197993');
    await user.click(call);
    expect(track).toHaveBeenCalledWith('concierge_call_click', { location: 'section' });
  });

  describe('the preview card', () => {
    const CARD_NAME = 'Try the AI Website Concierge';
    const expectedDetail = { source: 'section_cta', quickReply: 'Try the AI Concierge' };

    const collectOpenRequests = () => {
      const seen: OpenDetail[] = [];
      const listener = (e: Event) => seen.push((e as CustomEvent<OpenDetail>).detail);
      window.addEventListener(CONCIERGE_OPEN_EVENT, listener);
      return { seen, stop: () => window.removeEventListener(CONCIERGE_OPEN_EVENT, listener) };
    };

    it('is one real button with a clear accessible name', () => {
      render(<AiConcierge />);
      const card = screen.getByRole('button', { name: CARD_NAME });
      expect(card.tagName).toBe('BUTTON');
      expect(card).toHaveAttribute('type', 'button');
      expect(card).toHaveAttribute('aria-label', CARD_NAME);
      expect(card).toHaveClass('thg-cc-card-button');
    });

    it('keeps the fake chat inside it hidden from assistive tech, with nothing interactive in it', () => {
      render(<AiConcierge />);
      const card = screen.getByRole('button', { name: CARD_NAME });
      const preview = card.querySelector('.thg-cc-card');
      expect(preview).not.toBeNull();
      expect(preview).toHaveAttribute('aria-hidden', 'true');
      expect(card.querySelector('.thg-cc-card-pill')).toHaveAttribute('aria-hidden', 'true');
      // Valid inside a button: no nested controls, no block elements.
      expect(
        card.querySelectorAll('button, a, input, textarea, select, [tabindex], div, p, ol, ul, li')
      ).toHaveLength(0);
      // The fake chip, input and send stay inert spans. Only "Yes, call me" is drawn (no "No thanks").
      expect(card.querySelectorAll('.thg-cc-chip')).toHaveLength(1);
      expect(card.querySelector('.thg-cc-chip')).toHaveTextContent('Yes, call me');
      expect(card).not.toHaveTextContent('No thanks');
      expect(card.querySelector('.thg-cc-fake-input')?.tagName).toBe('SPAN');
      // The transcript is not exposed: every piece of it sits under an aria-hidden ancestor.
      for (const text of ['What do you do?', 'Yes, call me', 'Type your question…']) {
        expect(screen.getByText(text).closest('[aria-hidden="true"]')).not.toBeNull();
      }
    });

    it('shows the "Click to try it" pill (hidden from assistive tech, revealed by CSS on hover and focus)', () => {
      render(<AiConcierge />);
      expect(screen.getByRole('button', { name: CARD_NAME }).querySelector('.thg-cc-card-pill')).toHaveTextContent(
        'Click to try it'
      );
    });

    it('opens the real chat with the Try the AI Concierge chip when clicked, like "Try it now"', async () => {
      const user = userEvent.setup();
      const { seen, stop } = collectOpenRequests();
      render(<AiConcierge />);
      await user.click(screen.getByRole('button', { name: CARD_NAME }));
      stop();
      expect(seen).toEqual([expectedDetail]);
    });

    it('does the same when Enter is pressed on the focused card', async () => {
      const user = userEvent.setup();
      const { seen, stop } = collectOpenRequests();
      render(<AiConcierge />);
      const card = screen.getByRole('button', { name: CARD_NAME });
      card.focus();
      await user.keyboard('{Enter}');
      stop();
      expect(card).toHaveFocus();
      expect(seen).toEqual([expectedDetail]);
    });

    it('and when Space is pressed', async () => {
      const user = userEvent.setup();
      const { seen, stop } = collectOpenRequests();
      render(<AiConcierge />);
      screen.getByRole('button', { name: CARD_NAME }).focus();
      await user.keyboard(' ');
      stop();
      expect(seen).toEqual([expectedDetail]);
    });

    it('sends exactly the same request as the "Try it now" button', async () => {
      const user = userEvent.setup();
      const { seen, stop } = collectOpenRequests();
      render(<AiConcierge />);
      await user.click(screen.getByRole('button', { name: 'Try it now' }));
      await user.click(screen.getByRole('button', { name: CARD_NAME }));
      stop();
      expect(seen).toHaveLength(2);
      expect(seen[1]).toEqual(seen[0]);
    });

    it('is reached by Tab after the two calls to action, in page order', async () => {
      const user = userEvent.setup();
      render(<AiConcierge />);
      await user.tab();
      expect(screen.getByRole('button', { name: 'Try it now' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('link', { name: 'Call (866) 519-7993' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: CARD_NAME })).toHaveFocus();
    });

    it('is plain decoration (no button) when the chat helper is switched off', () => {
      vi.stubEnv('PROD', true);
      vi.stubEnv('VITE_CONCIERGE_API_URL', '');
      const { container } = render(<AiConcierge />);
      expect(screen.queryByRole('button', { name: CARD_NAME })).not.toBeInTheDocument();
      expect(screen.queryAllByRole('button')).toHaveLength(0);
      const card = container.querySelector('.thg-cc-card');
      expect(card).not.toBeNull();
      expect(card?.tagName).toBe('DIV');
      expect(card?.parentElement).toHaveAttribute('aria-hidden', 'true');
      expect(container.querySelector('.thg-cc-card-button')).toBeNull();
      expect(container.querySelector('.thg-cc-card-pill')).toBeNull();
      expect(card?.querySelectorAll('button, a, input, textarea, select')).toHaveLength(0);
    });

    it('is not clickable when switched off: no open request can come from it', async () => {
      vi.stubEnv('PROD', true);
      vi.stubEnv('VITE_CONCIERGE_API_URL', '');
      const user = userEvent.setup();
      const { seen, stop } = collectOpenRequests();
      const { container } = render(<AiConcierge />);
      await user.click(container.querySelector('.thg-cc-card') as Element);
      stop();
      expect(seen).toEqual([]);
    });

    it('uses the same widget styles in both modes, so the layout is identical', () => {
      const { container, unmount } = render(<AiConcierge />);
      const on = container.querySelector('.thg-cc-card');
      expect(on).toHaveClass('thg-cc-surface');
      expect(on?.closest('.aic-card')).not.toBeNull();
      unmount();

      vi.stubEnv('PROD', true);
      vi.stubEnv('VITE_CONCIERGE_API_URL', '');
      const off = render(<AiConcierge />).container.querySelector('.thg-cc-card');
      expect(off).toHaveClass('thg-cc-surface');
      expect(off?.closest('.aic-card')).not.toBeNull();
    });
  });

  it('jumps to the section on a fresh load with #ai-concierge in the URL', () => {
    window.history.replaceState({}, '', '/#ai-concierge');
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<AiConcierge />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('ai-concierge'));
  });

  it('does not scroll when there is no hash', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<AiConcierge />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
