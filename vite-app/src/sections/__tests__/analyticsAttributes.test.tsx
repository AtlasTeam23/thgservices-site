import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import Hero from '../Hero';
import Work from '../Work';
import FeaturedApp from '../FeaturedApp';
import Consulting from '../Consulting';
import AiConcierge from '../AiConcierge';
import About from '../About';
import { ThemeProvider } from '../../lib/theme';
import { initAnalytics } from '../../lib/analytics';

// Real sections, real click listener, observed at the dataLayer.
function sent(): unknown[][] {
  return (window.dataLayer ?? [])
    .map((entry) => Array.from(entry as ArrayLike<unknown>))
    .filter((call) => call[0] === 'event');
}

function ctaIn(container: HTMLElement, id: string): HTMLElement {
  const matches = container.querySelectorAll<HTMLElement>(`[data-cta-id="${id}"]`);
  expect(matches, `exactly one [data-cta-id="${id}"]`).toHaveLength(1);
  return matches[0];
}

const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
const originalScrollTo = window.scrollTo;

beforeAll(() => {
  vi.stubEnv('VITE_GA4_ID', 'G-TEST');
  vi.stubEnv('VITE_GA4_DEBUG', 'true');
  window.history.replaceState({}, '', '/from-estimate?utm_campaign=thg-ga');
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  initAnalytics();
  // jsdom has neither; the sections call them on click.
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  window.history.replaceState({}, '', '/');
  window.sessionStorage.clear();
  if (originalScrollIntoView) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
  } else {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  }
  window.scrollTo = originalScrollTo;
});

beforeEach(() => {
  window.dataLayer?.splice(0, window.dataLayer.length);
});

describe('Hero CTAs', () => {
  it('labels the three hero CTAs with static ids and labels', () => {
    const { container } = render(<Hero />);
    const products = ctaIn(container, 'hero_products');
    const contact = ctaIn(container, 'hero_contact');
    const pill = ctaIn(container, 'nav_contact');
    expect(products).toHaveAttribute('data-cta-label', 'Our products');
    expect(products).toHaveTextContent('Our products');
    expect(contact).toHaveAttribute('data-cta-label', 'Contact us');
    expect(contact.closest('.actions')).not.toBeNull();
    expect(pill).toHaveAttribute('data-cta-label', 'Contact us');
    expect(pill.closest('nav.pill')).not.toBeNull();
  });

  it('reports each as a cta_click from the hero with the brand', () => {
    const { container } = render(<Hero />);
    ctaIn(container, 'hero_products').click();
    ctaIn(container, 'hero_contact').click();
    ctaIn(container, 'nav_contact').click();
    // Hero is rendered without its page <section id> wrapper being in a Home, but it owns id="hero".
    expect(sent()).toEqual([
      ['event', 'cta_click', { cta_id: 'hero_products', cta_label: 'Our products', link_location: 'hero', brand: 'thg-ga' }],
      ['event', 'cta_click', { cta_id: 'hero_contact', cta_label: 'Contact us', link_location: 'hero', brand: 'thg-ga' }],
      ['event', 'cta_click', { cta_id: 'nav_contact', cta_label: 'Contact us', link_location: 'hero', brand: 'thg-ga' }],
    ]);
  });
});

describe('Work', () => {
  it('labels the Start a Conversation CTA', () => {
    const { container } = render(<Work />);
    const cta = ctaIn(container, 'products_start_conversation');
    expect(cta).toHaveAttribute('data-cta-label', 'Start a Conversation');
    expect(cta).toHaveTextContent('Start a Conversation');
    cta.click();
    expect(sent()).toEqual([
      ['event', 'cta_click', { cta_id: 'products_start_conversation', cta_label: 'Start a Conversation', link_location: 'products', brand: 'thg-ga' }],
    ]);
  });

  it('reports App Store links as app_store_click even though the link stops propagation', () => {
    const { container } = render(<Work />);
    const links = container.querySelectorAll<HTMLAnchorElement>('a[href*="apps.apple.com"]');
    expect(links.length).toBeGreaterThan(0);
    links[0].click();
    expect(sent()).toEqual([
      ['event', 'app_store_click', { store: 'ios', link_location: 'products', brand: 'thg-ga' }],
    ]);
  });
});

describe('FeaturedApp', () => {
  it('reports the App Store badge as app_store_click from bella-beast', () => {
    const { container } = render(
      <ThemeProvider>
        <FeaturedApp />
      </ThemeProvider>
    );
    container.querySelector<HTMLAnchorElement>('a[href*="apps.apple.com"]')!.click();
    expect(sent()).toEqual([
      ['event', 'app_store_click', { store: 'ios', link_location: 'bella-beast', brand: 'thg-ga' }],
    ]);
  });
});

describe('Consulting', () => {
  it('labels the Book a Conversation CTA', () => {
    const { container } = render(<Consulting />);
    const cta = ctaIn(container, 'consulting_book');
    expect(cta).toHaveAttribute('data-cta-label', 'Book a Conversation');
    expect(cta).toHaveTextContent('Book a Conversation');
    cta.click();
    expect(sent()).toEqual([
      ['event', 'cta_click', { cta_id: 'consulting_book', cta_label: 'Book a Conversation', link_location: 'consulting', brand: 'thg-ga' }],
    ]);
  });
});

describe('AiConcierge', () => {
  it('labels the Try it now button and reports it from ai-concierge', () => {
    const { container } = render(<AiConcierge />);
    const cta = ctaIn(container, 'concierge_try');
    expect(cta.tagName).toBe('BUTTON');
    expect(cta).toHaveAttribute('data-cta-label', 'Try it now');
    expect(cta).toHaveTextContent('Try it now');
    cta.click();
    expect(sent()).toContainEqual([
      'event',
      'cta_click',
      { cta_id: 'concierge_try', cta_label: 'Try it now', link_location: 'ai-concierge', brand: 'thg-ga' },
    ]);
  });

  it('reports the section phone link as phone_call_click from ai-concierge', () => {
    const { container } = render(<AiConcierge />);
    container.querySelector<HTMLAnchorElement>('a[href^="tel:"]')!.click();
    expect(sent()).toContainEqual([
      'event',
      'phone_call_click',
      { link_location: 'ai-concierge', brand: 'thg-ga' },
    ]);
  });
});

describe('About', () => {
  it('labels the Get in Touch CTA', () => {
    const { container } = render(<About />);
    const cta = ctaIn(container, 'about_contact');
    expect(cta).toHaveAttribute('data-cta-label', 'Get in Touch');
    expect(cta).toHaveTextContent('Get in Touch');
    cta.click();
    expect(sent()).toEqual([
      ['event', 'cta_click', { cta_id: 'about_contact', cta_label: 'Get in Touch', link_location: 'about', brand: 'thg-ga' }],
    ]);
  });

  it('reports the About phone link as phone_call_click from about, with no number in it', () => {
    const { container } = render(<About />);
    container.querySelector<HTMLAnchorElement>('a[href^="tel:"]')!.click();
    expect(sent()).toEqual([
      ['event', 'phone_call_click', { link_location: 'about', brand: 'thg-ga' }],
    ]);
    expect(JSON.stringify(sent())).not.toMatch(/866|519|7993/);
  });
});

describe('the full CTA inventory', () => {
  it('is exactly the eight agreed ids across the sections (the checker link is live)', () => {
    const ids = new Set<string>();
    const sections = [
      <Hero key="hero" />,
      <Work key="work" />,
      <ThemeProvider key="featured">
        <FeaturedApp />
      </ThemeProvider>,
      <Consulting key="consulting" />,
      <AiConcierge key="ai" />,
      <About key="about" />,
    ];
    for (const section of sections) {
      const { container, unmount } = render(section);
      container
        .querySelectorAll('[data-cta-id]')
        .forEach((n) => ids.add(n.getAttribute('data-cta-id')!));
      unmount();
    }
    expect([...ids].sort()).toEqual(
      [
        'about_contact',
        'concierge_try',
        'consulting_book',
        'consulting_checker',
        'hero_contact',
        'hero_products',
        'nav_contact',
        'products_start_conversation',
      ].sort()
    );
  });
});
