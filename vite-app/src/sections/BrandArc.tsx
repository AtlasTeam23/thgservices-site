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
      top: '40%',
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
        height: '50vh',
        backgroundColor: '#000000',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Arc wrapper */}
      <div
        ref={wrapperRef}
        style={{
          position: 'absolute',
          width: '150%',
          left: '50%',
          transform: 'translateX(-50%)',
          top: '120%',
        }}
      >
        <svg
          viewBox="0 0 1400 700"
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: '100%', height: 'auto' }}
        >
          <path
            className="arc-path"
            d="M0,700 Q700,0 1400,700"
          />
        </svg>
      </div>

      {/* Mask */}
      <div
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
        }}
      >
        <h2
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: 'clamp(32px, 3.5vw, 48px)',
            fontWeight: 600,
            color: '#FFFFFF',
            letterSpacing: '-0.02em',
          }}
        >
          Talk to us.
        </h2>
        <a
          href="mailto:developer@leadquik.com?subject=Inquiry%20from%20thgservices.io"
          style={{
            display: 'inline-block',
            marginTop: '32px',
            height: '48px',
            borderRadius: '24px',
            padding: '0 32px',
            backgroundColor: '#2563EB',
            color: '#FFFFFF',
            fontFamily: "'Outfit', sans-serif",
            fontSize: '14px',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase' as const,
            textDecoration: 'none',
            lineHeight: '48px',
            transition: 'background-color 0.3s ease',
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.backgroundColor = '#1E40AF';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.backgroundColor = '#2563EB';
          }}
        >
          Email developer@leadquik.com
        </a>
        <p
          style={{
            marginTop: '20px',
            fontFamily: "'Outfit', sans-serif",
            fontSize: '14px',
            color: 'rgba(255,255,255,0.5)',
          }}
        >
          Or call <a href="tel:+18665197993" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none' }}>+1 (866) 519-7993</a>
        </p>
      </div>
    </section>
  );
}