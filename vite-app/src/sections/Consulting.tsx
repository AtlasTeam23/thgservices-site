import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

type Service = {
  title: string;
  body: string;
};

const services: Service[] = [
  {
    title: 'Call handling',
    body: 'IVR setup, after-hours coverage, intelligent routing, and lead capture from your inbound phone line.',
  },
  {
    title: 'Email & inbox',
    body: "Automated triage, response templates, escalation rules, and shared-inbox flows that don't drop the ball.",
  },
  {
    title: 'Google Ads',
    body: 'Audit and optimize ad spend with 15+ years of AdWords experience — the same playbook that powers Blaze.',
  },
  {
    title: 'Website upgrades',
    body: 'Modernize legacy sites, fix conversion gaps, and set up analytics and tracking that actually work.',
  },
  {
    title: 'Chatbots & AI assistants',
    body: 'Deploy chatbots that answer FAQs, qualify leads, and hand off to humans when something needs a real person.',
  },
  {
    title: 'Claude Code & AI tooling',
    body: 'Use AI coding agents to ship internal tools, integrations, and one-off utilities in days, not months.',
  },
  {
    title: 'Custom scripts & automation',
    body: 'Glue your tools together, scrape what needs scraping, generate the reports nobody wants to build by hand.',
  },
  {
    title: 'Faster P&Ls',
    body: 'Connect QuickBooks or Xero to dashboards that surface margin and cash position in close to real time.',
  },
  {
    title: 'Bookkeeping cleanup',
    body: 'Clean up the books, set better categorization, and give your accountant something to smile about.',
  },
];

export default function Consulting() {
  const sectionRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const header = headerRef.current;
    const grid = gridRef.current;
    const cta = ctaRef.current;
    if (!section || !header || !grid || !cta) return;

    const headerSt = ScrollTrigger.create({
      trigger: section,
      start: 'top 80%',
      once: true,
      onEnter: () => {
        gsap.fromTo(
          header,
          { opacity: 0, y: 24 },
          { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }
        );
      },
    });

    const tiles = grid.querySelectorAll<HTMLElement>('.consult-tile');
    const tilesSt = ScrollTrigger.create({
      trigger: grid,
      start: 'top 85%',
      once: true,
      onEnter: () => {
        gsap.fromTo(
          tiles,
          { opacity: 0, y: 20 },
          {
            opacity: 1,
            y: 0,
            duration: 0.55,
            stagger: 0.06,
            ease: 'power3.out',
          }
        );
      },
    });

    const ctaSt = ScrollTrigger.create({
      trigger: cta,
      start: 'top 90%',
      once: true,
      onEnter: () => {
        gsap.fromTo(
          cta,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }
        );
      },
    });

    return () => {
      headerSt.kill();
      tilesSt.kill();
      ctaSt.kill();
    };
  }, []);

  return (
    <section
      id="consulting"
      ref={sectionRef}
      style={{
        width: '100%',
        backgroundColor: 'var(--thg-bg-page)',
        padding: 'clamp(80px, 10vw, 140px) clamp(24px, 5vw, 80px)',
        borderTop: '1px solid var(--thg-bg-section-border)',
        transition: 'background-color 0.3s ease',
      }}
    >
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        <div ref={headerRef} style={{ opacity: 0, marginBottom: '48px' }}>
          <span
            className="font-mono-label"
            style={{
              color: 'var(--thg-text-quaternary)',
              display: 'block',
              marginBottom: '20px',
            }}
          >
            Consulting
          </span>
          <h2
            className="font-heading-xl"
            style={{
              color: 'var(--thg-text-primary)',
              maxWidth: '820px',
              margin: 0,
            }}
          >
            Sit down with us. We&rsquo;ll help fix the boring stuff that&rsquo;s
            slowing you down.
          </h2>
          <p
            style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: '17px',
              lineHeight: 1.6,
              color: 'var(--thg-text-secondary)',
              maxWidth: '700px',
              margin: '20px 0 0',
            }}
          >
            25 years of running multi-state operations has shown us the same
            handful of fixes save business owners weeks of time and tens of
            thousands a year. We&rsquo;ll meet with you, understand how your
            day actually runs, then pick the right mix of software, scripts,
            and AI tooling to get you time and money back.
          </p>
        </div>

        <div
          ref={gridRef}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '16px',
          }}
        >
          {services.map((s) => (
            <div
              key={s.title}
              className="consult-tile"
              style={{
                opacity: 0,
                padding: '24px',
                border: '1px solid var(--thg-border-subtle)',
                borderRadius: '8px',
                background:
                  'linear-gradient(180deg, var(--thg-bg-elevated) 0%, transparent 100%)',
                transition: 'border-color 0.25s ease, transform 0.25s ease',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor =
                  'rgba(37,99,235,0.45)';
                (e.currentTarget as HTMLElement).style.transform =
                  'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor =
                  'var(--thg-border-subtle)';
                (e.currentTarget as HTMLElement).style.transform =
                  'translateY(0)';
              }}
            >
              <h3
                style={{
                  fontFamily: "'Outfit', sans-serif",
                  fontSize: '18px',
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  color: 'var(--thg-text-primary)',
                  margin: '0 0 10px',
                }}
              >
                {s.title}
              </h3>
              <p
                style={{
                  fontFamily: "'Outfit', sans-serif",
                  fontSize: '14px',
                  lineHeight: 1.55,
                  color: 'var(--thg-text-secondary)',
                  margin: 0,
                }}
              >
                {s.body}
              </p>
            </div>
          ))}
        </div>

        <div
          ref={ctaRef}
          style={{
            opacity: 0,
            marginTop: '56px',
            padding: '32px',
            border: '1px solid var(--thg-border-subtle)',
            borderRadius: '8px',
            background:
              'linear-gradient(180deg, var(--thg-bg-elevated) 0%, transparent 100%)',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            alignItems: 'flex-start',
          }}
          className="consult-cta"
        >
          <div>
            <h3
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontSize: 'clamp(22px, 2.4vw, 28px)',
                fontWeight: 600,
                letterSpacing: '-0.015em',
                color: 'var(--thg-text-primary)',
                margin: '0 0 8px',
              }}
            >
              Don&rsquo;t see your problem on the list?
            </h3>
            <p
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontSize: '15px',
                lineHeight: 1.55,
                color: 'var(--thg-text-secondary)',
                margin: 0,
                maxWidth: '640px',
              }}
            >
              The list above is what comes up most often. If your bottleneck is
              somewhere else, tell us about it and we&rsquo;ll figure out what
              tooling, software, or process actually fixes it.
            </p>
          </div>
          <a
            href="#contact"
            onClick={(e) => {
              e.preventDefault();
              document
                .querySelector('#contact')
                ?.scrollIntoView({ behavior: 'smooth' });
            }}
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
              (e.currentTarget as HTMLElement).style.backgroundColor =
                '#1E40AF';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor =
                '#2563EB';
            }}
          >
            Book a Conversation →
          </a>
        </div>
      </div>
    </section>
  );
}
