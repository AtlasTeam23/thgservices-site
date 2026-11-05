import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CHECKER_LINKS_LIVE } from '../config';
import Footer from '../../../sections/Footer';
import Consulting from '../../../sections/Consulting';
import Navigation from '../../../components/Navigation';
import { ThemeProvider } from '../../theme';

describe('the hidden launch (CHECKER_LINKS_LIVE = false)', () => {
  it('ships with the links switched off', () => {
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
