import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest globals are off, so Testing Library's automatic cleanup never
// registers itself. Do it here.
afterEach(() => {
  cleanup();
});

// jsdom cannot navigate. Swallow link clicks (tel: and http links) so tests
// that click them do not log "Not implemented: navigation".
document.addEventListener('click', (e) => {
  if ((e.target as Element | null)?.closest?.('a[href]')) e.preventDefault();
});

// jsdom has no matchMedia (GSAP's ScrollTrigger needs it at import time).
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
