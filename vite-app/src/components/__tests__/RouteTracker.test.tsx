import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router';

vi.mock('../../lib/analytics', () => ({ trackPageView: vi.fn() }));

import RouteTracker from '../RouteTracker';
import { trackPageView } from '../../lib/analytics';

function Tree({ initial }: { initial: string }) {
  return (
    <MemoryRouter initialEntries={[initial]}>
      <RouteTracker />
      <Link to="/">home</Link>
      <Link to="/from-estimate">estimate</Link>
      <Link to="/from-estimate?utm_campaign=sunshine">query</Link>
      <Link to="/from-estimate?utm_campaign=sunshine#ai-concierge">hash</Link>
      <Link to="/website-checker?r=REPORTTOKEN1234567890">report</Link>
    </MemoryRouter>
  );
}

function go(label: string) {
  fireEvent.click(screen.getByText(label));
}

function paths(): string[] {
  return vi.mocked(trackPageView).mock.calls.map((call) => call[0]);
}

describe('RouteTracker', () => {
  beforeEach(() => {
    vi.mocked(trackPageView).mockClear();
  });

  it('renders nothing', () => {
    const { container } = render(
      <MemoryRouter>
        <RouteTracker />
      </MemoryRouter>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('sends one page_view with the pathname on mount', () => {
    render(<Tree initial="/from-estimate?utm_campaign=thg-ga&email=a%40b.com" />);
    // Pathname only: the query is cleaned inside trackPageView.
    expect(paths()).toEqual(['/from-estimate']);
  });

  it('sends one more page_view per pathname change', () => {
    render(<Tree initial="/" />);
    go('estimate');
    go('home');
    expect(paths()).toEqual(['/', '/from-estimate', '/']);
  });

  it('never passes a website-checker report token (r) to analytics', () => {
    render(<Tree initial="/website-checker?r=REPORTTOKEN1234567890&utm_source=x" />);
    go('home');
    go('report');
    // Pathname only: no query string at all reaches trackPageView, so `r` cannot.
    expect(vi.mocked(trackPageView).mock.calls).toEqual([['/website-checker'], ['/'], ['/website-checker']]);
    expect(JSON.stringify(vi.mocked(trackPageView).mock.calls)).not.toContain('REPORTTOKEN');
  });

  it('sends nothing when only the query or hash changes', () => {
    render(<Tree initial="/from-estimate" />);
    go('query');
    go('hash');
    expect(paths()).toEqual(['/from-estimate']);
  });

  it('sends nothing on a re-render with the same path', () => {
    const { rerender } = render(<Tree initial="/" />);
    rerender(<Tree initial="/" />);
    expect(paths()).toEqual(['/']);
  });

  it('sends a single page_view on mount under StrictMode (effects run twice)', () => {
    render(
      <StrictMode>
        <Tree initial="/from-estimate" />
      </StrictMode>
    );
    expect(paths()).toEqual(['/from-estimate']);
  });

  it('sends one per path change under StrictMode', () => {
    render(
      <StrictMode>
        <Tree initial="/" />
      </StrictMode>
    );
    go('estimate');
    expect(paths()).toEqual(['/', '/from-estimate']);
  });
});
