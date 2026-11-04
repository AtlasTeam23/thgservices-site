import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../api', () => ({ postChat: vi.fn(), postLead: vi.fn() }));
vi.mock('../turnstile', () => ({ getToken: vi.fn() }));
vi.mock('../../../lib/track', () => ({ track: vi.fn() }));

import { Concierge, isConciergeEnabled } from '../index';
import { BUBBLE_LABEL } from '../copy';

describe('Concierge production gate', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders nothing in production when no Worker URL is configured', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_CONCIERGE_API_URL', '');
    const { container } = render(<Concierge />);
    expect(container).toBeEmptyDOMElement();
    expect(isConciergeEnabled()).toBe(false);
  });

  it('treats a blank (whitespace only) URL as empty', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_CONCIERGE_API_URL', '   ');
    const { container } = render(<Concierge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders in production once a Worker URL is configured', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_CONCIERGE_API_URL', 'https://thg-concierge.example.workers.dev');
    render(<Concierge />);
    expect(screen.getByRole('button', { name: BUBBLE_LABEL })).toBeInTheDocument();
    expect(isConciergeEnabled()).toBe(true);
  });

  it('keeps rendering in development with no URL, so the layout can be worked on', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('VITE_CONCIERGE_API_URL', '');
    render(<Concierge />);
    expect(screen.getByRole('button', { name: BUBBLE_LABEL })).toBeInTheDocument();
    expect(isConciergeEnabled()).toBe(true);
  });

  it('does not capture UTM parameters when it renders nothing', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_CONCIERGE_API_URL', '');
    window.history.replaceState({}, '', '/?utm_source=google');
    render(<Concierge />);
    expect(window.sessionStorage.getItem('thg-concierge-v1')).toBeNull();
    window.history.replaceState({}, '', '/');
  });
});
