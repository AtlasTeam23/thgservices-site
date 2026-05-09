import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export default function Problem() {
  const sectionRef = useRef<HTMLElement>(null);
  const eyebrowRef = useRef<HTMLSpanElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const statRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: section,
        start: 'top 75%',
        once: true,
      },
    });

    tl.fromTo(
      [eyebrowRef.current, headingRef.current],
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out' }
    );

    tl.fromTo(
      statRef.current,
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out' },
      '-=0.4'
    );

    tl.fromTo(
      bodyRef.current,
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' },
      '-=0.6'
    );

    return () => {
      tl.kill();
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      id="why"
      style={{
        width: '100%',
        backgroundColor: '#0A0A0F',
        padding: 'clamp(80px, 10vw, 140px) clamp(24px, 5vw, 80px)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle blue glow accent in corner */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-20%',
          right: '-10%',
          width: '50%',
          height: '120%',
          background:
            'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(37,99,235,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          maxWidth: '1280px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: '48px',
        }}
        className="md:!grid-cols-[1fr_1fr]"
      >
        {/* Left column - heading */}
        <div>
          <span
            ref={eyebrowRef}
            className="font-mono-label"
            style={{
              opacity: 0,
              color: 'rgba(255, 255, 255, 0.4)',
              display: 'block',
              marginBottom: '20px',
            }}
          >
            Why this matters
          </span>
          <h2
            ref={headingRef}
            className="font-heading-xl"
            style={{
              opacity: 0,
              color: '#FFFFFF',
              maxWidth: '560px',
              margin: 0,
            }}
          >
            Speed of response is the single biggest predictor of conversion.
          </h2>
        </div>

        {/* Right column - stat + body */}
        <div>
          <div
            ref={statRef}
            style={{
              opacity: 0,
              padding: '40px',
              border: '1px solid rgba(37, 99, 235, 0.25)',
              borderRadius: '8px',
              background:
                'linear-gradient(180deg, rgba(37,99,235,0.06) 0%, rgba(37,99,235,0) 100%)',
              marginBottom: '32px',
            }}
          >
            <div
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontSize: 'clamp(56px, 7vw, 88px)',
                fontWeight: 700,
                lineHeight: 0.95,
                letterSpacing: '-0.03em',
                color: '#FFFFFF',
                marginBottom: '16px',
              }}
            >
              21<span style={{ color: '#2563EB' }}>×</span>
            </div>
            <div
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontSize: '17px',
                lineHeight: 1.5,
                color: 'rgba(255, 255, 255, 0.85)',
                marginBottom: '12px',
                maxWidth: '460px',
              }}
            >
              More likely to qualify a lead when contacted within 5 minutes,
              compared to 30 minutes.
            </div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '11px',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'rgba(255, 255, 255, 0.4)',
              }}
            >
              Lead Response Management Study · Oldroyd, MIT / InsideSales.com
            </div>
          </div>

          <div
            ref={bodyRef}
            style={{
              opacity: 0,
              fontFamily: "'Outfit', sans-serif",
              fontSize: '17px',
              lineHeight: 1.6,
              color: 'rgba(255, 255, 255, 0.7)',
              maxWidth: '520px',
            }}
          >
            <p style={{ margin: '0 0 16px' }}>
              Speed wins deals. But for most small and mid-sized businesses,
              instant follow-up means staffing the phone and the inbox 24/7
              — which they can't afford.
            </p>
            <p style={{ margin: 0 }}>
              We build the software that closes that gap. Our flagship
              product,{' '}
              <a
                href="https://leadquik.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#2563EB', textDecoration: 'none', fontWeight: 600 }}
              >
                LeadQuik →
              </a>
              , replies to inbound leads in seconds with AI-driven first
              touch and human fallback. The rest of the THG Services product
              line extends the same idea across customer communications,
              operations, and reporting.
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @media (min-width: 900px) {
          section#why .md\\:\\!grid-cols-\\[1fr_1fr\\] {
            grid-template-columns: 1fr 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
