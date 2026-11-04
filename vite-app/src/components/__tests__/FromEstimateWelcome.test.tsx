import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FromEstimateWelcome from '../FromEstimateWelcome';

describe('FromEstimateWelcome', () => {
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

  beforeEach(() => {
    window.history.replaceState({}, '', '/from-estimate');
  });

  afterEach(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
    } else {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it('shows the eyebrow and the one-sentence welcome', () => {
    render(<FromEstimateWelcome />);
    expect(screen.getByText('From your estimate', { selector: '.font-mono-label' })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Thanks for reviewing your estimate. Here's how THG AI Services helps local businesses like yours run smoother."
      )
    ).toBeInTheDocument();
  });

  it('is a labelled region', () => {
    render(<FromEstimateWelcome />);
    expect(screen.getByRole('region', { name: 'From your estimate' })).toBeInTheDocument();
  });

  it('has a "See how we work" link to #ai-concierge', () => {
    render(<FromEstimateWelcome />);
    const link = screen.getByRole('link', { name: /See how we work/ });
    expect(link).toHaveAttribute('href', '#ai-concierge');
    expect(link).toHaveTextContent('See how we work ↓');
  });

  it('smooth-scrolls to the concierge section instead of jumping, and keeps the URL as it was', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const target = document.createElement('section');
    target.id = 'ai-concierge';
    document.body.appendChild(target);
    try {
      const user = userEvent.setup();
      render(<FromEstimateWelcome />);
      await user.click(screen.getByRole('link', { name: /See how we work/ }));
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
      expect(scrollIntoView.mock.contexts[0]).toBe(target);
      expect(window.location.hash).toBe('');
    } finally {
      target.remove();
    }
  });

  it('does not throw when the target section is missing', async () => {
    const user = userEvent.setup();
    render(<FromEstimateWelcome />);
    await user.click(screen.getByRole('link', { name: /See how we work/ }));
  });

  it('states no prices or numbers', () => {
    const { container } = render(<FromEstimateWelcome />);
    expect(container.textContent).not.toMatch(/[$\d]/);
  });
});
