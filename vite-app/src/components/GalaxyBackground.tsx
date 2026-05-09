import { useEffect, useRef } from 'react';

/**
 * GalaxyBackground
 *
 * Canvas-based starfield with subtle rotation and parallax depth.
 * - Pure 2D canvas (no Three.js / WebGL bundle cost)
 * - Two parallax layers + soft nebula glow
 * - Respects prefers-reduced-motion (renders a static field)
 * - Pauses when document is hidden
 */
export default function GalaxyBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const ctx2d = canvasEl.getContext('2d');
    if (!ctx2d) return;
    // Capture non-null aliases so nested closures don't trip TS narrowing
    const canvas: HTMLCanvasElement = canvasEl;
    const ctx: CanvasRenderingContext2D = ctx2d;

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    type Star = {
      x: number; // normalized [-1,1]
      y: number;
      z: number; // depth [0.2, 1] — closer = brighter & larger
      r: number; // radius
      tint: [number, number, number]; // rgb
      twinklePhase: number; // 0..2π
      twinkleSpeed: number;
    };

    type Nebula = {
      x: number;
      y: number;
      r: number;
      color: string;
      drift: number;
    };

    let stars: Star[] = [];
    let nebulae: Nebula[] = [];

    const STAR_TINTS: [number, number, number][] = [
      [255, 255, 255], // white
      [220, 235, 255], // cool white
      [200, 220, 255], // light blue
      [180, 200, 255], // blue
      [200, 200, 255], // soft purple
      [255, 240, 220], // warm white
    ];

    function pickTint(): [number, number, number] {
      // weight toward white/cool
      const r = Math.random();
      if (r < 0.45) return STAR_TINTS[0];
      if (r < 0.65) return STAR_TINTS[1];
      if (r < 0.78) return STAR_TINTS[2];
      if (r < 0.88) return STAR_TINTS[3];
      if (r < 0.96) return STAR_TINTS[4];
      return STAR_TINTS[5];
    }

    function generateStars() {
      const target = Math.min(
        450,
        Math.max(180, Math.round((width * height) / 4500))
      );
      stars = [];
      for (let i = 0; i < target; i++) {
        // Distribute with mild spiral concentration in middle
        const theta = Math.random() * Math.PI * 2;
        const radius = Math.pow(Math.random(), 1.4); // [0,1], biased to center
        const arm = Math.sin(theta * 2 + radius * 4) * 0.15;
        const x = Math.cos(theta) * radius + arm * Math.cos(theta);
        const y = Math.sin(theta) * radius * 0.85 + arm * Math.sin(theta);
        const z = 0.2 + Math.random() * 0.8;
        const r = (Math.random() * 1.0 + 0.3) * z;
        stars.push({
          x,
          y,
          z,
          r,
          tint: pickTint(),
          twinklePhase: Math.random() * Math.PI * 2,
          twinkleSpeed: 0.4 + Math.random() * 1.4,
        });
      }
    }

    function generateNebulae() {
      nebulae = [
        {
          x: 0.78,
          y: 0.18,
          r: 0.55,
          color: 'rgba(37, 99, 235, 0.10)', // blue
          drift: 0,
        },
        {
          x: 0.18,
          y: 0.92,
          r: 0.42,
          color: 'rgba(139, 92, 246, 0.05)', // violet
          drift: Math.PI,
        },
        {
          x: 0.55,
          y: 0.42,
          r: 0.7,
          color: 'rgba(20, 30, 70, 0.18)', // deep navy core
          drift: Math.PI / 2,
        },
      ];
    }

    function resize() {
      const rect = canvas.parentElement?.getBoundingClientRect();
      width = rect ? rect.width : window.innerWidth;
      height = rect ? rect.height : window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      generateStars();
      generateNebulae();
    }

    let rafId = 0;
    let startTime = performance.now();
    let lastFrameTime = startTime;
    let running = true;

    function frame(now: number) {
      if (!running) return;
      // 60fps cap
      const dt = now - lastFrameTime;
      if (dt < 14) {
        rafId = requestAnimationFrame(frame);
        return;
      }
      lastFrameTime = now;

      const t = (now - startTime) / 1000; // seconds

      // Clear with deep base color
      ctx.fillStyle = '#04050A';
      ctx.fillRect(0, 0, width, height);

      // Nebula clouds (radial gradients drifting)
      for (const n of nebulae) {
        const drift = reducedMotion ? 0 : Math.sin(t * 0.05 + n.drift) * 30;
        const cx = n.x * width + drift;
        const cy = n.y * height + drift * 0.6;
        const r = Math.min(width, height) * n.r;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, n.color);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      }

      // Galaxy rotation — extremely slow
      const angle = reducedMotion ? 0 : t * 0.012; // ~radians per second
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      const cx = width * 0.55;
      const cy = height * 0.5;
      const scale = Math.min(width, height) * 0.7;

      // Stars
      for (const s of stars) {
        // Rotate
        const rx = s.x * cosA - s.y * sinA;
        const ry = s.x * sinA + s.y * cosA;

        const px = cx + rx * scale * (0.6 + s.z * 0.4);
        const py = cy + ry * scale * (0.6 + s.z * 0.4);

        if (px < -10 || px > width + 10 || py < -10 || py > height + 10) {
          continue;
        }

        // Twinkle
        const twinkle = reducedMotion
          ? 0.85
          : 0.65 + 0.35 * Math.sin(t * s.twinkleSpeed + s.twinklePhase);

        const alpha = Math.min(1, s.z * 0.85 * twinkle);
        const radius = s.r * (0.6 + s.z * 0.6);

        // Soft glow halo for the larger / closer stars
        if (s.z > 0.7 && s.r > 0.8) {
          const haloGrad = ctx.createRadialGradient(
            px,
            py,
            0,
            px,
            py,
            radius * 6
          );
          haloGrad.addColorStop(
            0,
            `rgba(${s.tint[0]},${s.tint[1]},${s.tint[2]},${alpha * 0.18})`
          );
          haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = haloGrad;
          ctx.beginPath();
          ctx.arc(px, py, radius * 6, 0, Math.PI * 2);
          ctx.fill();
        }

        // Star core
        ctx.fillStyle = `rgba(${s.tint[0]},${s.tint[1]},${s.tint[2]},${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(frame);
    }

    function onVisibility() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(rafId);
      } else if (!running) {
        running = true;
        lastFrameTime = performance.now();
        rafId = requestAnimationFrame(frame);
      }
    }

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 120);
    }

    resize();
    rafId = requestAnimationFrame(frame);

    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        // Slight overall fade at top/bottom to blend with section edges
        maskImage:
          'linear-gradient(to bottom, transparent 0%, #000 12%, #000 88%, transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0%, #000 12%, #000 88%, transparent 100%)',
      }}
    />
  );
}
