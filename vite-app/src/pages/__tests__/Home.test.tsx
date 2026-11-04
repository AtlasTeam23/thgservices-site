import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../hooks/useLenis', () => ({ useLenis: vi.fn() }));
vi.mock('../../sections/Hero', () => ({ default: () => <section id="hero" data-testid="hero" /> }));
vi.mock('../../sections/Problem', () => ({ default: () => <section id="why" /> }));
vi.mock('../../sections/Work', () => ({ default: () => <section id="products" /> }));
vi.mock('../../sections/FeaturedApp', () => ({ default: () => <section id="bella-beast" /> }));
vi.mock('../../sections/Consulting', () => ({ default: () => <section id="consulting" /> }));
vi.mock('../../sections/AiConcierge', () => ({ default: () => <section id="ai-concierge" /> }));
vi.mock('../../sections/Capabilities', () => ({ default: () => <section id="capabilities" /> }));
vi.mock('../../sections/About', () => ({ default: () => <section id="about" /> }));
vi.mock('../../sections/BrandArc', () => ({ default: () => <section id="contact" /> }));
vi.mock('../../sections/Footer', () => ({ default: () => <footer data-testid="footer" /> }));

import Home from '../Home';

describe('Home', () => {
  it('has no welcome band by default', () => {
    render(<Home />);
    expect(screen.queryByRole('region', { name: 'From your estimate' })).not.toBeInTheDocument();
    expect(screen.getByRole('main').firstElementChild).toBe(screen.getByTestId('hero'));
  });

  it('puts the welcome band first in <main>, above the hero, when fromEstimate is set', () => {
    render(<Home fromEstimate />);
    const main = screen.getByRole('main');
    const band = screen.getByRole('region', { name: 'From your estimate' });
    expect(main.firstElementChild).toBe(band);
    expect(band.nextElementSibling).toBe(screen.getByTestId('hero'));
  });

  it('renders the same sections either way, with the footer outside <main>', () => {
    const { container, unmount } = render(<Home />);
    const plain = Array.from(container.querySelectorAll('main > section')).map((s) => s.id);
    unmount();
    const withBand = render(<Home fromEstimate />);
    const estimate = Array.from(withBand.container.querySelectorAll('main > section'))
      .map((s) => s.id)
      .filter(Boolean);
    expect(estimate).toEqual(plain);
    expect(screen.getByTestId('footer').closest('main')).toBeNull();
  });
});
