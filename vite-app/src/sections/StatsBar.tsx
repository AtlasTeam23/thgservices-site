import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const stats = [
  { target: 150, suffix: '+', label: 'Projects Delivered' },
  { target: 12, suffix: '', label: 'Years of Experience' },
  { target: 98, suffix: '%', label: 'Client Satisfaction' },
  { target: 24, suffix: '', label: 'Industry Awards' },
];

function StatItem({ target, suffix, label }: { target: number; suffix: string; label: string }) {
  const itemRef = useRef<HTMLDivElement>(null);
  const numberRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    const el = itemRef.current;
    const numEl = numberRef.current;
    if (!el || !numEl) return;

    const st = ScrollTrigger.create({
      trigger: el,
      start: 'top 85%',
      onEnter: () => {
        if (hasAnimated.current) return;
        hasAnimated.current = true;

        const obj = { val: 0 };
        const grad = { angle: 0 };

        const tl = gsap.timeline();

        tl.to(obj, {
          val: target,
          duration: 2.0,
          ease: 'power2.out',
          onUpdate: () => {
            numEl.innerText = Math.round(obj.val) + suffix;
          },
        }, 0);

        tl.to(grad, {
          angle: 360,
          duration: 2.0 * 0.85,
          ease: 'power2.inOut',
          onUpdate: () => {
            numEl.style.background = `conic-gradient(from 0deg, #2563EB ${grad.angle}deg, transparent ${grad.angle}deg)`;
            numEl.style.webkitBackgroundClip = 'text';
            numEl.style.backgroundClip = 'text';
            numEl.style.webkitTextFillColor = 'transparent';
          },
        }, 0);
      },
    });

    return () => {
      st.kill();
    };
  }, [target, suffix]);

  return (
    <div ref={itemRef} style={{ textAlign: 'center' }}>
      <div className="stat-dot" style={{ margin: '0 auto 12px' }} />
      <div ref={numberRef} className="stat-number">
        0
      </div>
      <div className="stat-label" style={{ marginTop: '8px' }}>
        {label}
      </div>
    </div>
  );
}

export default function StatsBar() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const st = ScrollTrigger.create({
      trigger: section,
      start: 'top 85%',
      onEnter: () => {
        gsap.fromTo(
          section,
          { opacity: 0, y: 40 },
          { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' }
        );
      },
      once: true,
    });

    return () => st.kill();
  }, []);

  return (
    <section
      ref={sectionRef}
      style={{
        width: '100%',
        backgroundColor: '#F3F4F6',
        padding: '64px clamp(24px, 5vw, 80px)',
        opacity: 0,
      }}
    >
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '48px',
        }}
      >
        {stats.map((stat, i) => (
          <StatItem key={i} {...stat} />
        ))}
      </div>
    </section>
  );
}