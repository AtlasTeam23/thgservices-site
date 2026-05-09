import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export default function BrandArc() {
  const sectionRef = useRef<HTMLElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!section || !wrapper || !content) return;

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: section,
        start: 'top 80%',
        toggleActions: 'play none none none',
      },
    });

    tl.to(wrapper, {
      top: '50%',
      duration: 2,
      ease: 'power2.out',
      delay: 0.3,
    });

    tl.fromTo(
      content,
      { y: 30, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out' },
      0
    );

    return () => {
      tl.kill();
    };
  }, []);

  return (
    <section
      id="contact"
      ref={sectionRef}
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '70vh',
        backgroundColor: '#000000',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'clamp(80px, 10vw, 140px) clamp(24px, 5vw, 80px)',
      }}
    >
      {/* Arc */}
      <div
        ref={wrapperRef}
        style={{
          position: 'absolute',
          width: '160%',
          left: '50%',
          transform: 'translateX(-50%)',
          top: '120%',
          pointerEvents: 'none',
        }}
      >
        <svg
          viewBox="0 0 1400 700"
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: '100%', height: 'auto' }}
        >
          <path className="arc-path" d="M0,700 Q700,0 1400,700" />
        </svg>
      </div>

      {/* Top mask gradient */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '40%',
          background:
            'radial-gradient(ellipse 90% 55% at 50% 0%, #000000 40%, rgba(0, 0, 0, 0) 100%)',
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />

      {/* Content */}
      <div
        ref={contentRef}
        style={{
          position: 'relative',
          zIndex: 3,
          textAlign: 'center',
          opacity: 0,
          maxWidth: '720px',
        }}
      >
        <span
          className="font-mono-label"
          style={{
            display: 'block',
            color: 'rgba(255,255,255,0.5)',
            marginBottom: '20px',
          }}
        >
          Get in Touch
        </span>

        <h2
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: 'clamp(36px, 4.5vw, 64px)',
            fontWeight: 600,
            color: '#FFFFFF',
            letterSpacing: '-0.025em',
            margin: 0,
            lineHeight: 1.05,
          }}
        >
          Talk to us.
        </h2>

        <p
          style={{
            marginTop: '20px',
            fontFamily: "'Outfit', sans-serif",
            fontSize: '17px',
            lineHeight: 1.55,
            color: 'rgba(255, 255, 255, 0.65)',
            maxWidth: '520px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          Customers, partners, investors, or anyone curious about what we’re
          building — we’d like to hear from you.
        </p>

        <div
          style={{
            display: 'flex',
            gap: '12px',
            marginTop: '36px',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <a
            href="mailto:developer@leadquik.com?subject=Inquiry%20from%20thgservices.io"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '48px',
              padding: '0 28px',
              borderRadius: '24px',
              backgroundColor: '#2563EB',
              color: '#FFFFFF',
              fontFamily: "'Outfit', sans-serif",
              fontSize: '14px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              transition: 'background-color 0.2s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = '#1E40AF';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = '#2563EB';
            }}
          >
            Email developer@leadquik.com
          </a>
          <a
            href="tel:+18665197993"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '48px',
              padding: '0 28px',
              borderRadius: '24px',
              backgroundColor: 'transparent',
              color: '#FFFFFF',
              border: '1px solid rgba(255,255,255,0.18)',
              fontFamily: "'Outfit', sans-serif",
              fontSize: '14px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              transition: 'border-color 0.2s ease, background-color 0.2s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.45)';
              (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.04)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.18)';
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            }}
          >
            Call +1 (866) 519-7993
          </a>
        </div>

        <div
          style={{
            marginTop: '40px',
            paddingTop: '32px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '12px',
            letterSpacing: '0.06em',
            color: 'rgba(255,255,255,0.45)',
            lineHeight: 1.7,
          }}
        >
          THG SERVICES, LLC · 300 COLONIAL CENTER PKWY, SUITE 100N
          <br />
          ROSWELL, GA 30076 · D-U-N-S 12-981-2006
        </div>
      </div>
    </section>
  );
}
