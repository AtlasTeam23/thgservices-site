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

  it('builds the preview card from the real widget styles and hides it from assistive tech', () => {
    const { container } = render(<AiConcierge />);
    const card = container.querySelector('.thg-cc-card');
    expect(card).not.toBeNull();
    expect(card?.parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(card?.querySelectorAll('button, a, input, textarea, select')).toHaveLength(0);
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
