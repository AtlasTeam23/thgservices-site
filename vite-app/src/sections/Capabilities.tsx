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
    word: 'Respond',
    subtitle: 'Inbound lead response',
    description:
      'AI-driven first touch in seconds, with human fallback so no opportunity goes cold.',
  },
  {
    number: '02',
    word: 'Connect',
    subtitle: 'Multi-channel comms',
    description:
      'SMS, email, and voice in one place — orchestrated so customers always get a reply.',
  },
  {
    number: '03',
    word: 'Operate',
    subtitle: 'Workflows that fit',
    description:
      'Tools shaped around how small and mid-sized teams actually work day-to-day.',
  },
  {
    number: '04',
    word: 'Report',
    subtitle: 'Visibility on what matters',
    description:
      'Clear metrics on response time, conversion, and revenue — without spreadsheet gymnastics.',
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
        backgroundColor: '#0A0A0F',
        backgroundImage:
          'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
        backgroundSize: '64px 64px',
        padding: 'clamp(80px, 10vw, 140px) clamp(24px, 5vw, 80px)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        <span
          className="font-mono-label"
          style={{
            color: 'rgba(255, 255, 255, 0.4)',
            display: 'block',
            marginBottom: '20px',
          }}
        >
          Capabilities
        </span>
        <h2
          className="font-heading-xl"
          style={{
            color: '#FFFFFF',
            maxWidth: '720px',
            margin: 0,
          }}
        >
          What our software does for the businesses that use it.
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
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '8px',
                background: 'rgba(255,255,255,0.02)',
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
                  'rgba(255,255,255,0.08)';
                (e.currentTarget as HTMLElement).style.background =
                  'rgba(255,255,255,0.02)';
              }}
            >
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '12px',
                  letterSpacing: '0.12em',
                  color: 'rgba(255,255,255,0.4)',
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
                  color: '#FFFFFF',
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
                  color: 'rgba(255,255,255,0.65)',
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
