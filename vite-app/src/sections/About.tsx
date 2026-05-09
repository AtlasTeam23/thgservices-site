import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export default function About() {
  const sectionRef = useRef<HTMLElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    if (!section || !left || !right) return;

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: section,
        start: 'top 75%',
        once: true,
      },
    });

    tl.fromTo(
      left,
      { opacity: 0, x: -40 },
      { opacity: 1, x: 0, duration: 0.9, ease: 'power3.out' }
    );

    tl.fromTo(
      right,
      { opacity: 0, x: 40 },
      { opacity: 1, x: 0, duration: 0.9, ease: 'power3.out' },
      '-=0.75'
    );

    return () => {
      tl.kill();
    };
  }, []);

  return (
    <section
      id="about"
      ref={sectionRef}
      style={{
        width: '100%',
        backgroundColor: '#F3F4F6',
        padding: 'clamp(64px, 10vw, 140px) clamp(24px, 5vw, 80px)',
      }}
    >
      <div
        style={{
          maxWidth: '1440px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: '80px',
          alignItems: 'start',
        }}
        className="md:!grid-cols-[55%_45%]"
      >
        {/* Left column */}
        <div ref={leftRef} style={{ opacity: 0 }}>
          <span
            className="font-mono-label"
            style={{
              color: '#6B7280',
              display: 'block',
              marginBottom: '24px',
            }}
          >
            About
          </span>
          <h2
            className="font-heading-xl"
            style={{
              color: '#111827',
              maxWidth: '720px',
            }}
          >
            Software built by an operator who needed it.
          </h2>
          <p
            className="font-body-lg"
            style={{
              color: '#111827',
              maxWidth: '560px',
              marginTop: '32px',
            }}
          >
            THG Services, LLC is a software company headquartered in Roswell,
            Georgia. We design, build, and support our own products —
            handling everything from concept and engineering through customer
            onboarding and long-term support.
          </p>
          <p
            className="font-body-lg"
            style={{
              color: '#111827',
              maxWidth: '560px',
              marginTop: '20px',
            }}
          >
            Our flagship product,{' '}
            <a
              href="https://leadquik.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#2563EB', textDecoration: 'none', fontWeight: 600 }}
            >
              LeadQuik
            </a>
            , was built by an operator who got tired of leaking inbound leads
            to slow follow-up. We work directly with the businesses that use
            our software, and we ship product based on what they actually
            need — not what looks good in a roadmap deck.
          </p>
          <a
            href="#contact"
            onClick={(e) => {
              e.preventDefault();
              document.querySelector('#contact')?.scrollIntoView({ behavior: 'smooth' });
            }}
            style={{
              display: 'inline-block',
              marginTop: '40px',
              fontFamily: "'Outfit', sans-serif",
              fontSize: '14px',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase' as const,
              color: '#2563EB',
              textDecoration: 'none',
              position: 'relative',
            }}
          >
            Get in Touch
            <span
              style={{
                display: 'block',
                height: '1px',
                backgroundColor: '#2563EB',
                width: '0%',
                transition: 'width 0.3s ease',
                marginTop: '4px',
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.width = '100%';
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.width = '0%';
              }}
            />
          </a>
        </div>

        {/* Right column - key facts (replaced stock portrait image) */}
        <div ref={rightRef} style={{ opacity: 0 }}>
          <div
            style={{
              border: '1px solid rgba(17, 24, 39, 0.08)',
              borderRadius: '4px',
              padding: '40px',
              background: '#FFFFFF',
              maxWidth: '460px',
              marginLeft: 'auto',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.06)',
            }}
          >
            <div
              className="font-mono-label"
              style={{ color: '#6B7280', marginBottom: '24px' }}
            >
              At a Glance
            </div>
            {([
              { k: 'Legal name', v: 'THG Services, LLC' },
              { k: 'Headquarters', v: '300 Colonial Center Pkwy, Suite 100N\nRoswell, GA 30076' },
              { k: 'D-U-N-S Number', v: '12-981-2006' },
              {
                k: 'Flagship product',
                v: (
                  <a
                    href="https://leadquik.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#2563EB', textDecoration: 'none', fontWeight: 600 }}
                  >
                    LeadQuik →
                  </a>
                ),
              },
              { k: 'In development', v: 'Atlas · CashPulse · Blaze' },
              {
                k: 'Email',
                v: (
                  <a
                    href="mailto:developer@leadquik.com"
                    style={{ color: '#111827', textDecoration: 'none' }}
                  >
                    developer@leadquik.com
                  </a>
                ),
              },
              {
                k: 'Phone',
                v: (
                  <a
                    href="tel:+18665197993"
                    style={{ color: '#111827', textDecoration: 'none' }}
                  >
                    +1 (866) 519-7993
                  </a>
                ),
              },
            ] as { k: string; v: React.ReactNode }[]).map((row, i, arr) => (
              <div
                key={row.k}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 1fr',
                  gap: '16px',
                  paddingBottom: i === arr.length - 1 ? 0 : '12px',
                  marginBottom: i === arr.length - 1 ? 0 : '12px',
                  borderBottom:
                    i === arr.length - 1
                      ? 'none'
                      : '1px solid rgba(17,24,39,0.06)',
                }}
              >
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '11px',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: '#6B7280',
                    paddingTop: '4px',
                  }}
                >
                  {row.k}
                </div>
                <div
                  style={{
                    fontFamily: "'Outfit', sans-serif",
                    fontSize: '15px',
                    color: '#111827',
                    whiteSpace: 'pre-line',
                    lineHeight: 1.45,
                  }}
                >
                  {row.v as React.ReactNode}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @media (min-width: 768px) {
          .md\\:!grid-cols-\\[55\\%_45\\%\\] {
            grid-template-columns: 55% 45% !important;
          }
        }
      `}</style>
    </section>
  );
}