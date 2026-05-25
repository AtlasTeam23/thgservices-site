import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

type Capability = {
  number: string;
  word: string;
  subtitle: string;
  description: string;
};

const capabilities: Capability[] = [
  {
    number: '01',
    word: 'Speed',
    subtitle: 'Reply in seconds',
    description:
      'AI-driven first touch combined with human fallback — so no inbound lead waits long enough to go cold.',
  },
  {
    number: '02',
    word: 'Channels',
    subtitle: 'One unified inbox',
    description:
      'SMS, email, and voice handled in one place. Customers don’t care which channel they use, and your team shouldn’t either.',
  },
  {
    number: '03',
    word: 'Workflow',
    subtitle: 'Fits how teams work',
    description:
      'Tooling designed around the way small and mid-sized teams actually run — no 18-month implementation, no consultants required.',
  },
  {
    number: '04',
    word: 'Visibility',
    subtitle: 'Metrics that move revenue',
    description:
      'Response time, conversion, pipeline. Clean dashboards focused on what closes deals — not vanity numbers.',
  },
];

export default function Capabilities() {
  const sectionRef = useRef<HTMLElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const cards = cardsRef.current;
    if (!section || !cards) return;

    const items = cards.querySelectorAll<HTMLElement>('.cap-card');

    const st = ScrollTrigger.create({
      trigger: section,
      start: 'top 75%',
      onEnter: () => {
        gsap.fromTo(
          items,
          { opacity: 0, y: 24 },
          {
            opacity: 1,
            y: 0,
            duration: 0.7,
            stagger: 0.08,
            ease: 'power3.out',
          }
        );
      },
      once: true,
    });

    return () => st.kill();
  }, []);

  return (
    <section
      id="capabilities"
      ref={sectionRef}
      style={{
        width: '100%',
        backgroundColor: 'var(--thg-bg-section)',
        backgroundImage:
          'linear-gradient(var(--thg-border-faint) 1px, transparent 1px), linear-gradient(90deg, var(--thg-border-faint) 1px, transparent 1px)',
        backgroundSize: '64px 64px',
        padding: 'clamp(80px, 10vw, 140px) clamp(24px, 5vw, 80px)',
        borderTop: '1px solid var(--thg-bg-section-border)',
        borderBottom: '1px solid var(--thg-bg-section-border)',
        transition: 'background-color 0.3s ease',
      }}
    >
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        <span
          className="font-mono-label"
          style={{
            color: 'var(--thg-text-quaternary)',
            display: 'block',
            marginBottom: '20px',
          }}
        >
          Capabilities
        </span>
        <h2
          className="font-heading-xl"
          style={{
            color: 'var(--thg-text-primary)',
            maxWidth: '760px',
            margin: 0,
          }}
        >
          Four principles run through every product we ship.
        </h2>

        <div
          ref={cardsRef}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '24px',
            marginTop: '64px',
          }}
        >
          {capabilities.map((c) => (
            <div
              key={c.number}
              className="cap-card"
              style={{
                opacity: 0,
                padding: '32px 28px',
                border: '1px solid var(--thg-border-subtle)',
                borderRadius: '8px',
                background: 'var(--thg-bg-elevated)',
                transition: 'border-color 0.25s ease, background 0.25s ease',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor =
                  'rgba(37,99,235,0.45)';
                (e.currentTarget as HTMLElement).style.background =
                  'rgba(37,99,235,0.04)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor =
                  'var(--thg-border-subtle)';
                (e.currentTarget as HTMLElement).style.background =
                  'var(--thg-bg-elevated)';
              }}
            >
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '12px',
                  letterSpacing: '0.12em',
                  color: 'var(--thg-text-quaternary)',
                  marginBottom: '20px',
                }}
              >
                {c.number} / {c.subtitle}
              </div>
              <div
                style={{
                  fontFamily: "'Outfit', sans-serif",
                  fontSize: 'clamp(28px, 2.6vw, 36px)',
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                  color: 'var(--thg-text-primary)',
                  marginBottom: '14px',
                }}
              >
                {c.word}
              </div>
              <p
                style={{
                  fontFamily: "'Outfit', sans-serif",
                  fontSize: '15px',
                  lineHeight: 1.55,
                  color: 'var(--thg-text-secondary)',
                  margin: 0,
                }}
              >
                {c.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
