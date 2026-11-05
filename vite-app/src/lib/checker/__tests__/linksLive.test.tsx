import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The public launch flips this one constant.
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  CHECKER_LINKS_LIVE: true,
}));

import Footer from '../../../sections/Footer';
import Consulting from '../../../sections/Consulting';
import Navigation from '../../../components/Navigation';
import { ThemeProvider } from '../../theme';

describe('the public launch (CHECKER_LINKS_LIVE = true)', () => {
  it('links to /website-checker/ from the nav, the footer and the Website upgrades item', () => {
    const { container } = render(
      <ThemeProvider>
        <Navigation />
        <Consulting />
        <Footer />
      </ThemeProvider>
    );
    const links = Array.from(container.querySelectorAll('a[href="/website-checker/"]'));
    // Nav (desktop or mobile menu is closed, so one), Consulting, Footer.
    expect(links.length).toBeGreaterThanOrEqual(3);
    const consulting = container.querySelector('#consulting a[href="/website-checker/"]');
    expect(consulting).toHaveTextContent('Free website checker');
    expect(container.querySelector('footer a[href="/website-checker/"]')).toBeInTheDocument();
    expect(container.querySelector('nav a[href="/website-checker/"]')).toBeInTheDocument();
    expect(screen.getAllByText(/Free website checker/).length).toBeGreaterThanOrEqual(3);
  });
});
