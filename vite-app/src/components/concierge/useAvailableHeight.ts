import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  const vv = window.visualViewport;
  window.addEventListener('resize', onChange);
  vv?.addEventListener('resize', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    vv?.removeEventListener('resize', onChange);
  };
}

// The visual viewport shrinks when the on-screen keyboard opens; innerHeight does not.
const getSnapshot = () => Math.round(window.visualViewport?.height ?? window.innerHeight);

/** Height in px the visitor can actually see, keyboard included. */
export function useAvailableHeight(): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => 800);
}
