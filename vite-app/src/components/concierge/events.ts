import { isKnownChip } from './copy';
import type { OpenSource } from './types';

export const CONCIERGE_OPEN_EVENT = 'thg:concierge:open';

export type OpenDetail = {
  source: OpenSource;
  /** A chip label to run as if the visitor tapped it, once the greeting shows. */
  quickReply?: string;
};

/** Open the chat panel from anywhere on the page (for example a section button). */
export function openConcierge(detail: OpenDetail): void {
  window.dispatchEvent(
    new CustomEvent<OpenDetail>(CONCIERGE_OPEN_EVENT, { detail })
  );
}

/** Subscribe to open requests. Returns an unsubscribe function. */
export function onConciergeOpen(handler: (detail: OpenDetail) => void): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<Partial<OpenDetail> | null>).detail;
    const source: OpenSource =
      detail?.source === 'section_cta' ? 'section_cta' : 'bubble';
    // Only the widget's own chips can be run; anything else is dropped.
    const quickReply =
      typeof detail?.quickReply === 'string' && isKnownChip(detail.quickReply)
        ? detail.quickReply
        : undefined;
    handler(quickReply ? { source, quickReply } : { source });
  };
  window.addEventListener(CONCIERGE_OPEN_EVENT, listener);
  return () => window.removeEventListener(CONCIERGE_OPEN_EVENT, listener);
}
