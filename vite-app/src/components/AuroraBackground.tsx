import { useEffect, useRef } from 'react';

/**
 * AuroraBackground
 *
 * Light-mode counterpart to GalaxyBackground. Soft animated gradient
 * mesh of blue/violet/cream that drifts slowly. Pure CSS-driven
 * gradient animation on a canvas-style div — no canvas, no GPU shaders.
 *
 * - Respects prefers-reduced-motion (renders a static mesh)
 * - Pauses animation when document hidden
 * - Edge-fades top/bottom to blend with section borders, same as
 *   GalaxyBackground
 */
export default function AuroraBackground() {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      el.style.animationPlayState = 'paused';
      return;
    }

    function onVisibility() {
      if (!el) return;
      el.style.animationPlayState = document.hidden ? 'paused' : 'running';
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return (
    <>
      <div
        ref={wrapRef}
        aria-hidden="true"
        className="thg-aurora"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          maskImage:
            'linear-gradient(to bottom, transparent 0%, #000 12%, #000 88%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, #000 12%, #000 88%, transparent 100%)',
        }}
      />
      <style>{`
        .thg-aurora {
          background-image:
            radial-gradient(circle at 18% 22%, rgba(99, 102, 241, 0.22) 0%, transparent 38%),
            radial-gradient(circle at 82% 18%, rgba(37, 99, 235, 0.18) 0%, transparent 42%),
            radial-gradient(circle at 70% 78%, rgba(168, 85, 247, 0.14) 0%, transparent 45%),
            radial-gradient(circle at 22% 82%, rgba(14, 165, 233, 0.15) 0%, transparent 40%),
            linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, rgba(250, 250, 249, 0.6) 100%);
          background-size: 140% 140%, 130% 130%, 130% 130%, 140% 140%, 100% 100%;
          background-position: 0% 0%, 100% 0%, 80% 100%, 0% 100%, 0% 0%;
          animation: thgAuroraDrift 28s ease-in-out infinite alternate;
        }
        @keyframes thgAuroraDrift {
          0% {
            background-position: 0% 0%, 100% 0%, 80% 100%, 0% 100%, 0% 0%;
          }
          50% {
            background-position: 8% 6%, 92% 8%, 72% 92%, 8% 92%, 0% 0%;
          }
          100% {
            background-position: 4% 10%, 96% 4%, 78% 96%, 4% 96%, 0% 0%;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .thg-aurora {
            animation: none;
          }
        }
      `}</style>
    </>
  );
}
