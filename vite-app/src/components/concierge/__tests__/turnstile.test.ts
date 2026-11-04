import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RenderOptions = {
  sitekey: string;
  execution?: string;
  callback: (token: string) => void;
  'error-callback': () => void;
  'timeout-callback'?: () => void;
};

const SCRIPT_SELECTOR = 'script[src*="challenges.cloudflare.com/turnstile"]';

function installTurnstile() {
  const api = {
    render: vi.fn<(container: HTMLElement, options: Record<string, unknown>) => string>(
      () => 'widget-1'
    ),
    execute: vi.fn(),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  window.turnstile = api;
  return api;
}

const optionsOf = (api: ReturnType<typeof installTurnstile>, call = 0) =>
  api.render.mock.calls[call][1] as unknown as RenderOptions;

describe('turnstile', () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.querySelectorAll(SCRIPT_SELECTOR).forEach((s) => s.remove());
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    delete window.turnstile;
  });

  it('resolves null immediately with no sitekey and loads no script', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    const { getToken } = await import('../turnstile');
    await expect(getToken()).resolves.toBeNull();
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
  });

  it('lazy-loads api.js in explicit mode and resolves the token from the callback', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000BB');
    const { getToken } = await import('../turnstile');

    const pending = getToken();
    await vi.waitFor(() =>
      expect(document.querySelector(SCRIPT_SELECTOR)).not.toBeNull()
    );
    const script = document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
    expect(script?.src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');

    const api = installTurnstile();
    script?.dispatchEvent(new Event('load'));
    await vi.waitFor(() => expect(api.execute).toHaveBeenCalledTimes(1));

    const opts = optionsOf(api);
    expect(opts.sitekey).toBe('1x00000000000000000000BB');
    expect(opts.execution).toBe('execute');
    expect(api.execute).toHaveBeenCalledWith('widget-1');
    opts.callback('token-1');
    await expect(pending).resolves.toBe('token-1');
  });

  it('reuses the widget for later tokens: reset, then execute, and no second script', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000BB');
    const api = installTurnstile();
    const { getToken } = await import('../turnstile');

    const first = getToken();
    await vi.waitFor(() => expect(api.execute).toHaveBeenCalledTimes(1));
    optionsOf(api).callback('token-1');
    await expect(first).resolves.toBe('token-1');

    const second = getToken();
    await vi.waitFor(() => expect(api.execute).toHaveBeenCalledTimes(2));
    expect(api.reset).toHaveBeenCalledWith('widget-1');
    expect(api.render).toHaveBeenCalledTimes(1);
    optionsOf(api).callback('token-2');
    await expect(second).resolves.toBe('token-2');
    expect(document.querySelectorAll(SCRIPT_SELECTOR)).toHaveLength(0);
  });

  it('resolves null when the script fails to load', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000BB');
    const { getToken } = await import('../turnstile');
    const pending = getToken();
    await vi.waitFor(() =>
      expect(document.querySelector(SCRIPT_SELECTOR)).not.toBeNull()
    );
    document.querySelector(SCRIPT_SELECTOR)?.dispatchEvent(new Event('error'));
    await expect(pending).resolves.toBeNull();
  });

  it('resolves null when the widget reports an error', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000BB');
    const api = installTurnstile();
    const { getToken } = await import('../turnstile');
    const pending = getToken();
    await vi.waitFor(() => expect(api.execute).toHaveBeenCalled());
    optionsOf(api)['error-callback']();
    await expect(pending).resolves.toBeNull();
  });

  it('resolves null if no token arrives before the timeout', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000BB');
    const api = installTurnstile();
    const { getToken, TOKEN_TIMEOUT_MS } = await import('../turnstile');
    vi.useFakeTimers();
    const pending = getToken();
    await vi.advanceTimersByTimeAsync(10);
    expect(api.execute).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TOKEN_TIMEOUT_MS);
    await expect(pending).resolves.toBeNull();
  });
});
