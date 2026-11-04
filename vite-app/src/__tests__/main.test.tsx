import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => {
    calls.push('createRoot');
    return { render: vi.fn(() => calls.push('render')) };
  }),
}));
vi.mock('../lib/analytics', () => ({
  initAnalytics: vi.fn(() => calls.push('initAnalytics')),
}));
vi.mock('../App.tsx', () => ({ default: () => null }));

describe('main.tsx', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.resetModules();
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('calls initAnalytics() exactly once, before createRoot() and the first render', async () => {
    await import('../main');
    expect(calls).toEqual(['initAnalytics', 'createRoot', 'render']);
  });
});
