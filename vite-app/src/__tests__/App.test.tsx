import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../lib/analytics', () => ({ trackPageView: vi.fn() }));
vi.mock('../components/concierge', () => ({
  Concierge: () => <div data-testid="concierge" />,
}));
vi.mock('../pages/Home', () => ({
  default: ({ fromEstimate }: { fromEstimate?: boolean }) => (
    <div data-testid="home" data-from-estimate={fromEstimate ? 'true' : 'false'} />
  ),
}));

import App from '../App';
import { trackPageView } from '../lib/analytics';

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>
  );
}

describe('App routes', () => {
  beforeEach(() => {
    vi.mocked(trackPageView).mockClear();
  });

  it('renders the plain homepage at /', () => {
    renderAt('/');
    expect(screen.getByTestId('home')).toHaveAttribute('data-from-estimate', 'false');
  });

  it('renders the homepage with the estimate welcome at /from-estimate, query string and all', () => {
    renderAt('/from-estimate?utm_source=leadquik&utm_medium=estimate&utm_campaign=thg-ga&utm_content=TEST123');
    expect(screen.getByTestId('home')).toHaveAttribute('data-from-estimate', 'true');
  });

  it('mounts the concierge outside the routes, so both paths get it', () => {
    const { unmount } = renderAt('/');
    expect(screen.getByTestId('concierge')).toBeInTheDocument();
    unmount();
    renderAt('/from-estimate');
    expect(screen.getByTestId('concierge')).toBeInTheDocument();
  });

  it('sends one page_view for the landing path', () => {
    renderAt('/from-estimate?utm_campaign=thg-ga');
    expect(trackPageView).toHaveBeenCalledTimes(1);
    expect(trackPageView).toHaveBeenCalledWith('/from-estimate');
  });

  it('sends a page_view for / too', () => {
    renderAt('/');
    expect(trackPageView).toHaveBeenCalledTimes(1);
    expect(trackPageView).toHaveBeenCalledWith('/');
  });
});
