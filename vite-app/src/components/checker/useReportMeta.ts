import { useEffect } from 'react';

/**
 * While a report link is open, tell search engines not to index the page and
 * browsers not to send a Referer header from it, so the token in the address
 * cannot leak to a third party. Both tags are removed again when the token goes.
 */
export function useReportMeta(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const added: HTMLMetaElement[] = [];
    for (const [name, content] of [
      ['robots', 'noindex'],
      ['referrer', 'no-referrer'],
    ] as const) {
      const meta = document.createElement('meta');
      meta.name = name;
      meta.content = content;
      meta.setAttribute('data-checker-report', '');
      document.head.appendChild(meta);
      added.push(meta);
    }
    return () => added.forEach((m) => m.remove());
  }, [active]);
}
