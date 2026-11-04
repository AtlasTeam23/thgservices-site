// The always-loaded shell: a fixed button, the open/close state, and a lazy
// import of the panel. Everything heavy (state machine, forms, API, Turnstile)
// lives behind that import so the main bundle only pays for this file.

import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import './bubble.css';
import { track } from '../../lib/track';
import type { ChatPanelProps, OpenRequest } from './ChatPanel';
import { BUBBLE_LABEL, ERROR } from './copy';
import { onConciergeOpen, type OpenDetail } from './events';
import PhoneText from './PhoneText';
import { captureLanding } from './storage';

export type PanelLoader = () => Promise<{ default: ComponentType<ChatPanelProps> }>;

const defaultLoader: PanelLoader = () => import('./ChatPanel');

// One lazy component per (loader, attempt). React.lazy remembers a rejected
// import for good, so a retry has to be a fresh component; keeping them here
// (not creating them while rendering) means re-renders reuse the same one.
const lazyPanels = new WeakMap<PanelLoader, ComponentType<ChatPanelProps>[]>();
function panelFor(loader: PanelLoader, attempt: number): ComponentType<ChatPanelProps> {
  let attempts = lazyPanels.get(loader);
  if (!attempts) {
    attempts = [];
    lazyPanels.set(loader, attempts);
  }
  return (attempts[attempt] ??= lazy(loader));
}

/**
 * The panel chunk is only a convenience (a click loads it on demand), so the
 * background download keeps out of the way of the first paint: the hero
 * headline is the LCP element and waits on a webfont.
 */
const PREFETCH_DELAY_MS = 4000;

/**
 * Run `task` at least PREFETCH_DELAY_MS after the page's `load` event, and then
 * only when the browser reports it is idle. Returns a function that cancels
 * whichever stage is still pending.
 */
function whenIdle(task: () => void): () => void {
  let cancelled = false;
  let cancel = () => {};

  const idle = () => {
    if (cancelled) return;
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(task, { timeout: 5000 });
      cancel = () => window.cancelIdleCallback(id);
    } else {
      task(); // no idle callbacks (Safari): the delay alone is the courtesy
    }
  };

  const afterLoad = () => {
    if (cancelled) return;
    const id = window.setTimeout(idle, PREFETCH_DELAY_MS);
    cancel = () => window.clearTimeout(id);
  };

  if (document.readyState === 'complete') {
    afterLoad();
  } else {
    window.addEventListener('load', afterLoad, { once: true });
    cancel = () => window.removeEventListener('load', afterLoad);
  }
  return () => {
    cancelled = true;
    cancel();
  };
}

/**
 * Shown in place of the panel when its chunk cannot be loaded (offline, or a
 * stale page after a deploy). Only visible while the chat is open.
 */
function ChunkNotice({
  open,
  onRetry,
  onClose,
}: {
  open: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const retryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) retryRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="thg-cc-surface thg-cc-notice"
      role="alert"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <p>
        <PhoneText text={ERROR} />
      </p>
      <div className="thg-cc-notice-actions">
        <button ref={retryRef} type="button" className="thg-cc-chip" onClick={onRetry}>
          Try again
        </button>
        <button type="button" className="thg-cc-chip" onClick={onClose}>
          Close chat
        </button>
      </div>
    </div>
  );
}

/** Catches the lazy import rejecting so one failed download cannot take the page down. */
class PanelBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function ChatBubble({ panelLoader = defaultLoader }: { panelLoader?: PanelLoader }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const requestCount = useRef(0);

  const Panel = panelFor(panelLoader, attempt);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  const requestOpen = useCallback(
    (detail: OpenDetail) => {
      track('concierge_open', { source: detail.source });
      requestCount.current += 1;
      setRequest({ ...detail, id: requestCount.current });
      setMounted(true);
      setOpen(true);
      if (failed) retry(); // asking again after a failed download tries the download again
    },
    [failed, retry]
  );

  const close = useCallback(() => setOpen(false), []);
  const dismissNotice = useCallback(() => {
    setOpen(false);
    bubbleRef.current?.focus();
  }, []);

  useEffect(() => onConciergeOpen(requestOpen), [requestOpen]);

  // Remember where the visitor arrived from (UTM) now, not when the chat first opens.
  useEffect(() => {
    captureLanding();
  }, []);

  // Fetch the panel chunk in the background (a few seconds after load, see whenIdle)
  // so the first click feels instant.
  useEffect(
    () =>
      whenIdle(() => {
        panelLoader().catch(() => {});
      }),
    [panelLoader]
  );

  return (
    <div className="thg-cc-root">
      <button
        ref={bubbleRef}
        type="button"
        className="thg-cc-bubble"
        data-open={open}
        aria-label={BUBBLE_LABEL}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : requestOpen({ source: 'bubble' }))}
      >
        <svg className="thg-cc-icon-chat" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4 9 9 0 0 1-3.6-.8L3 20.5l1.5-4.7A8.4 8.4 0 1 1 21 11.5Z" />
        </svg>
        <svg className="thg-cc-icon-close" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
        {/* The visible text equals the accessible name (WCAG 2.5.3, label-content-name-mismatch). */}
        <span className="thg-cc-bubble-label" aria-hidden="true">
          {BUBBLE_LABEL}
        </span>
      </button>

      {mounted && (
        <PanelBoundary
          key={attempt}
          onError={() => setFailed(true)}
          fallback={<ChunkNotice open={open} onRetry={retry} onClose={dismissNotice} />}
        >
          <Suspense
            fallback={
              open ? (
                <div className="thg-cc-surface thg-cc-notice" role="status">
                  <p>Loading chat…</p>
                </div>
              ) : null
            }
          >
            {/* panelFor() hands back the same cached component until a retry bumps `attempt`,
                so its identity is stable between renders, which is what this rule protects. */}
            {/* eslint-disable-next-line react-hooks/static-components */}
            <Panel open={open} request={request} onClose={close} returnFocusRef={bubbleRef} />
          </Suspense>
        </PanelBoundary>
      )}
    </div>
  );
}
