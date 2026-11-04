// Lazy Cloudflare Turnstile loader. Nothing is fetched until a token is
// actually needed, and getToken() returns null at once when no sitekey is
// configured (so local dev and a not-yet-enabled production build skip it).

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const TOKEN_TIMEOUT_MS = 12000;

let scriptPromise: Promise<TurnstileApi | null> | null = null;
let widgetId: string | null = null;
let onResult: ((token: string | null) => void) | null = null;
let queue: Promise<unknown> = Promise.resolve();

const sitekey = () => (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim();

const hasSitekey = () => sitekey().length > 0;

function loadScript(): Promise<TurnstileApi | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(window.turnstile ?? null);
      script.onerror = () => {
        scriptPromise = null; // allow a later retry
        script.remove();
        resolve(null);
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

function ensureWidget(api: TurnstileApi, key: string): string {
  if (widgetId !== null) {
    api.reset(widgetId);
    return widgetId;
  }
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.cssText =
    'position:fixed;left:-9999px;bottom:0;width:0;height:0;overflow:hidden;';
  document.body.appendChild(container);
  widgetId = api.render(container, {
    sitekey: key,
    execution: 'execute',
    callback: (token: string) => onResult?.(token),
    'error-callback': () => {
      onResult?.(null);
      return true;
    },
    'timeout-callback': () => onResult?.(null),
  });
  return widgetId;
}

async function fetchToken(): Promise<string | null> {
  const key = sitekey();
  if (!key) return null;
  const api = await loadScript();
  if (!api) return null;

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      onResult = null;
      resolve(token);
    };
    const timer = setTimeout(() => finish(null), TOKEN_TIMEOUT_MS);
    onResult = finish;
    try {
      // Tokens are single use, so every request resets the widget and runs it again.
      api.execute(ensureWidget(api, key));
    } catch {
      finish(null);
    }
  });
}

/** A fresh single-use token, or null if Turnstile is off, blocked or slow. */
export function getToken(): Promise<string | null> {
  if (!hasSitekey()) return Promise.resolve(null);
  const run = queue.then(fetchToken, fetchToken);
  queue = run.catch(() => null);
  return run;
}
