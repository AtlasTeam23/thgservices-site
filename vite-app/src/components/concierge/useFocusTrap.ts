import { useEffect, useRef, type RefObject } from 'react';

type Options = {
  active: boolean;
  onEscape: () => void;
  /** Where focus goes when the trap deactivates (the chat bubble). */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Preferred element to focus on activation; falls back to the first focusable. */
  getInitialFocus?: () => HTMLElement | null | undefined;
};

const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.hasAttribute('disabled') || el.tabIndex < 0) return false;
    if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

const isDisabled = (el: HTMLElement) =>
  el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true';

/**
 * Keeps Tab / Shift+Tab inside `containerRef` while `active`, closes on Esc,
 * and hands focus back to `returnFocusRef` (or whatever had it) afterwards.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  { active, onEscape, returnFocusRef, getInitialFocus }: Options
) {
  // Latest callbacks without re-running the trap on every render.
  const latest = useRef({ onEscape, returnFocusRef, getInitialFocus });
  useEffect(() => {
    latest.current = { onEscape, returnFocusRef, getInitialFocus };
  });

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previous = document.activeElement as HTMLElement | null;
    const returnTarget = latest.current.returnFocusRef?.current ?? previous;

    // A disabled preferred element cannot take focus, so treat it as "no preference".
    const preferred = latest.current.getInitialFocus?.();
    const usable = preferred && !isDisabled(preferred) ? preferred : null;
    const initial = usable ?? getFocusable(container)[0] ?? container;
    initial.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const current = document.activeElement;
      const inside = current instanceof Node && container.contains(current);

      if (e.key === 'Escape') {
        // Ignore Esc pressed in some unrelated control elsewhere on the page.
        if (e.defaultPrevented || !(inside || current === document.body)) return;
        latest.current.onEscape();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = getFocusable(container);
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (current === first || current === container)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
    };
  }, [active, containerRef]);
}
