import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import ContactForm from '../components/ContactForm';

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
        backgroundColor: 'var(--thg-bg-section)',
        transition: 'background-color 0.3s ease',
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
            color: 'var(--thg-text-tertiary)',
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
            color: 'var(--thg-text-primary)',
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
            color: 'var(--thg-text-secondary)',
            maxWidth: '520px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          Customers, partners, investors, or anyone curious about what we’re
          building — we’d like to hear from you.
        </p>

        <ContactForm />

        <div
          style={{
            marginTop: '40px',
            paddingTop: '32px',
            borderTop: '1px solid var(--thg-border-subtle)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '12px',
            letterSpacing: '0.06em',
            color: 'var(--thg-text-tertiary)',
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
