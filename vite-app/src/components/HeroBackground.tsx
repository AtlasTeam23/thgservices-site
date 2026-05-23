import { useEffect, useRef, useState } from 'react';
import GalaxyBackground from './GalaxyBackground';

/**
 * HeroBackground
 *
 * Renders the hero video as the primary background, falling back to
 * GalaxyBackground when:
 *   - the user prefers reduced motion, or
 *   - the video element reports a load/playback error.
 *
 * The video is muted, looping, inline, and has no audio track — safe for
 * Apple review and A2P verification screens.
 */
export default function HeroBackground() {
  const [useFallback, setUseFallback] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setUseFallback(true);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  if (useFallback) {
    return <GalaxyBackground />;
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden="true"
      onError={() => setUseFallback(true)}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        pointerEvents: 'none',
        maskImage:
          'linear-gradient(to bottom, transparent 0%, #000 12%, #000 88%, transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0%, #000 12%, #000 88%, transparent 100%)',
      }}
    >
      <source src="/grok-hero.mp4" type="video/mp4" />
    </video>
  );
}
