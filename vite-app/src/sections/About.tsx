import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export default function About() {
  const sectionRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = gridRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    if (!grid || !left || !right) return;

    // Trigger on the two-column grid, not the section — the banner photo
    // added above the grid pushes the grid ~640px below the section top,
    // so a section-based trigger would animate columns while they're
    // still off-screen on laptops.
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: grid,
        start: 'top 85%',
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
        backgroundColor: 'var(--thg-bg-about)',
        padding: 'clamp(64px, 10vw, 140px) clamp(24px, 5vw, 80px)',
        transition: 'background-color 0.3s ease',
      }}
    >
      <div
        ref={gridRef}
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
              color: 'var(--thg-text-about-dim)',
              display: 'block',
              marginBottom: '24px',
            }}
          >
            About
          </span>
          <h2
            className="font-heading-xl"
            style={{
              color: 'var(--thg-text-about-heading)',
              maxWidth: '720px',
            }}
          >
            Software built by an operator who needed it.
          </h2>
          <p
            className="font-body-lg"
            style={{
              color: 'var(--thg-text-about-body)',
              maxWidth: '560px',
              marginTop: '32px',
            }}
          >
            THG Services, LLC is a software company based in Woodstock,
            Georgia. We design, build, and support our own products —
            handling everything from concept and engineering through customer
            onboarding and long-term support.
          </p>
          <p
            className="font-body-lg"
            style={{
              color: 'var(--thg-text-about-body)',
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
              border: '1px solid var(--thg-border-about)',
              borderRadius: '4px',
              padding: '40px',
              background: 'var(--thg-bg-about-card)',
              maxWidth: '460px',
              marginLeft: 'auto',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.06)',
              transition: 'background-color 0.3s ease, border-color 0.3s ease',
            }}
          >
            <div
              className="font-mono-label"
              style={{ color: 'var(--thg-text-about-dim)', marginBottom: '24px' }}
            >
              At a Glance
            </div>
            {([
              { k: 'Legal name', v: 'THG Services, LLC' },
              { k: 'Based in', v: 'Woodstock, GA' },
              { k: 'D-U-N-S Number', v: '12-981-2006' },
              {
                k: 'Flagship',
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
              { k: 'In development', v: 'CashPulse' },
              {
                k: 'Beta',
                v: (
                  <>
                    <a
                      href="https://blastlands.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#DB2777', textDecoration: 'none', fontWeight: 600 }}
                    >
                      Blast Lands →
                    </a>
                    {' · '}
                    <a
                      href="https://highlightsreel.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#06B6D4', textDecoration: 'none', fontWeight: 600 }}
                    >
                      Highlights Reel →
                    </a>
                  </>
                ),
              },
              {
                k: 'Client apps',
                v: (
                  <>
                    <a
                      href="https://bellabeast.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#009C3B', textDecoration: 'none', fontWeight: 600 }}
                    >
                      Bella Beast →
                    </a>
                    {' · '}
                    <a
                      href="https://photomemorylane.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#D97706', textDecoration: 'none', fontWeight: 600 }}
                    >
                      Memory Lane →
                    </a>
                  </>
                ),
              },
              {
                k: 'Email',
                v: (
                  <a
                    href="mailto:developer@leadquik.com"
                    style={{ color: 'var(--thg-text-about-body)', textDecoration: 'none' }}
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
                    style={{ color: 'var(--thg-text-about-body)', textDecoration: 'none' }}
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
                      : '1px solid var(--thg-border-about)',
                }}
              >
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '11px',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--thg-text-about-dim)',
                    paddingTop: '4px',
                  }}
                >
                  {row.k}
                </div>
                <div
                  style={{
                    fontFamily: "'Outfit', sans-serif",
                    fontSize: '15px',
                    color: 'var(--thg-text-about-heading)',
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

      {/* Founder subsection — sits below the two-column About grid */}
      <div
        style={{
          maxWidth: '1440px',
          margin: '80px auto 0',
          paddingTop: '48px',
          borderTop: '1px solid var(--thg-border-about)',
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: '48px',
          alignItems: 'start',
        }}
        className="md:!grid-cols-[1fr_2fr] about-founder"
      >
        {/* Left: Founder portrait only */}
        <div>
          <div
            style={{
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid var(--thg-border-about)',
              aspectRatio: '4 / 5',
              maxWidth: '320px',
            }}
          >
            <img
              src="/photos/david-brannan-founder.jpg"
              alt="David Brannan, founder of THG AI Services"
              loading="lazy"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          </div>
        </div>

        {/* Right: Founder label + name + credentials rail + bio */}
        <div>
          <span
            className="font-mono-label"
            style={{
              color: 'var(--thg-text-about-dim)',
              display: 'block',
              marginBottom: '20px',
            }}
          >
            Founder
          </span>
          <h3
            style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: 'clamp(28px, 3vw, 40px)',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: 'var(--thg-text-about-heading)',
              margin: 0,
            }}
          >
            David Brannan
          </h3>
          <p
            className="font-body-lg"
            style={{
              color: 'var(--thg-text-about-body)',
              maxWidth: '640px',
              margin: '28px 0 0',
            }}
          >
            David brings 25 years of running multiple seven-figure
            businesses to the software desk at THG AI Services. With a
            career-long focus on running multiple businesses, he writes
            code the same way he runs operations — eliminate the busywork
            between the problem and the result.
          </p>
          <p
            className="font-body-lg"
            style={{
              color: 'var(--thg-text-about-body)',
              maxWidth: '640px',
              marginTop: '20px',
            }}
          >
            Today he manages and organizes companies across multiple states.
            Every app on the THG AI Services line started with a problem he
            hit as an operator first.
          </p>
        </div>
      </div>

      <style>{`
        @media (min-width: 768px) {
          .md\\:!grid-cols-\\[55\\%_45\\%\\] {
            grid-template-columns: 55% 45% !important;
          }
          /* Founder subsection: left col sized to the portrait so the
             text (eyebrow + name + credentials + bio) sits snug alongside
             rather than 144px of dead gutter in a loose 1fr. */
          .about-founder.md\\:\\!grid-cols-\\[1fr_2fr\\] {
            grid-template-columns: minmax(0, 320px) 1fr !important;
            gap: 56px !important;
          }
        }
      `}</style>
    </section>
  );
}