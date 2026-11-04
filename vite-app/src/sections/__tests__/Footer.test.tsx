import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import Footer from '../Footer';
import { ThemeProvider } from '../../lib/theme';

const REVIEW_URL = 'https://g.page/r/CUWk6o39bFvcEBI/review';
const REVIEW_LABEL = 'Review us on Google (opens in a new tab)';

describe('Footer Google review link', () => {
  it('shows the review link twice (Legal column and bottom row) with safe new-tab attributes', () => {
    render(
      <ThemeProvider>
        <Footer />
      </ThemeProvider>,
    );

    const links = screen.getAllByRole('link', { name: REVIEW_LABEL });
    expect(links).toHaveLength(2);

    for (const link of links) {
      expect(link).toHaveAttribute('href', REVIEW_URL);
      expect(link).toHaveAttribute('target', '_blank');
      const rel = (link.getAttribute('rel') ?? '').split(/\s+/);
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');
      expect(link).toHaveTextContent('Review us on Google');
    }
  });
});
