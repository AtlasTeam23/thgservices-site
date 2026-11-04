import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { trackPageView } from '../lib/analytics';

/**
 * Sends one GA4 page_view for the first render and one for every pathname
 * change. The query string and hash are ignored here (a hash jump is not a new
 * page) and cleaned inside trackPageView. Renders nothing.
 */
export default function RouteTracker() {
  const { pathname } = useLocation();
  // StrictMode runs effects twice on mount; remembering the last path keeps
  // that to one page_view.
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    trackPageView(pathname);
  }, [pathname]);

  return null;
}
