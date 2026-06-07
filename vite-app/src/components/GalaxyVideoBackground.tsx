import { useEffect, useRef, useState } from 'react';
import GalaxyBackground from './GalaxyBackground';

/**
 * GalaxyVideoBackground
 *
 * Dark-mode hero background: plays a looping cinematic galaxy MP4
 * (vite-app/public/grok-galaxy.mp4). Falls back to the procedural
 * canvas starfield (GalaxyBackground) when:
 *
 *   - the user prefers reduced motion, or
 *   - the video element reports a load / playback error.
 *
 * The video is muted, looping, inline, no audio track, no controls —
 * safe for Apple review and A2P verification screens.
 */
export default function GalaxyVideoBackground() {
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
        // Same top/bottom edge fade as the canvas starfield so the
        // video blends into the adjacent section borders.
        maskImage:
          'linear-gradient(to bottom, transparent 0%, #000 12%, #000 88%, transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0%, #000 12%, #000 88%, transparent 100%)',
      }}
    >
      <source src="/grok-galaxy.mp4" type="video/mp4" />
    </video>
  );
}
