import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
// The switch can go back to false (the hidden launch); this pins that state whatever the real constant is.
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  CHECKER_LINKS_LIVE: false,
}));

import { CHECKER_LINKS_LIVE } from '../config';
import Footer from '../../../sections/Footer';
import Consulting from '../../../sections/Consulting';
import Navigation from '../../../components/Navigation';
import { ThemeProvider } from '../../theme';

describe('the hidden launch (CHECKER_LINKS_LIVE = false)', () => {
  it('reads the switch as off', () => {
    expect(CHECKER_LINKS_LIVE).toBe(false);
  });

  it('shows no link to the checker in the nav, the footer or the Website upgrades item', () => {
    const { container } = render(
      <ThemeProvider>
        <Navigation />
        <Consulting />
        <Footer />
      </ThemeProvider>
    );
    expect(container.querySelector('a[href*="website-checker"]')).toBeNull();
    expect(screen.queryByText(/website checker/i)).toBeNull();
    // The item itself is still there.
    expect(screen.getByText('Website upgrades')).toBeInTheDocument();
  });
});
