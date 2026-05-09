import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

type Product = {
  name: string;
  status: 'Live' | 'In development';
  tagline: string;
  description: string;
  href?: string;
  accent: string;
};

const products: Product[] = [
  {
    name: 'LeadQuik',
    status: 'Live',
    tagline: 'Lead response platform',
    description:
      'The instant a new lead comes in, LeadQuik replies in seconds with AI-driven first-touch and human fallback so no opportunity goes cold. Used by businesses across services, professional, and retail categories.',
    href: 'https://leadquik.com',
    accent: '#2563EB',
  },
  {
    name: 'Atlas',
    status: 'In development',
    tagline: 'Field operations & customer comms',
    description:
      'Field operations and customer communication tools for service businesses. Currently in private testing with select customers.',
    accent: '#F59E0B',
  },
  {
    name: 'CashPulse',
    status: 'In development',
    tagline: 'Cash flow visibility',
    description:
      'Cash flow visibility and financial tooling for owner-operators. Currently in private testing.',
    accent: '#10B981',
  },
  {
    name: 'Blaze',
    status: 'In development',
    tagline: 'Marketing & outreach automation',
    description:
      'Marketing and outreach automation for small business teams. Currently in private testing.',
    accent: '#EF4444',
  },
];

export default function Work() {
  const sectionRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const header = headerRef.current;
    const grid = gridRef.current;
    if (!section || !header || !grid) return;

    const headerSt = ScrollTrigger.create({
      trigger: section,
      start: 'top 80%',
      onEnter: () => {
        gsap.fromTo(
          header,
          { opacity: 0, y: 24 },
          { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }
        );
      },
      once: true,
    });

    const cards = grid.querySelectorAll<HTMLElement>('.product-card');
    const cardsSt = ScrollTrigger.create({
      trigger: grid,
      start: 'top 85%',
      onEnter: () => {
        gsap.fromTo(
          cards,
          { opacity: 0, y: 24 },
          {
            opacity: 1,
            y: 0,
            duration: 0.65,
            stagger: 0.08,
            ease: 'power3.out',
          }
        );
      },
      once: true,
    });

    return () => {
      headerSt.kill();
      cardsSt.kill();
    };
  }, []);

  const renderCard = (p: Product) => {
    const isLink = !!p.href;
    const Wrap: 'a' | 'div' = isLink ? 'a' : 'div';
    const wrapProps: React.HTMLAttributes<HTMLElement> & {
      href?: string;
      target?: string;
      rel?: string;
    } = isLink
      ? {
          href: p.href!,
          target: '_blank',
          rel: 'noopener noreferrer',
        }
      : {};

    return (
      <Wrap
        key={p.name}
        className="product-card"
        {...wrapProps}
        style={{
          opacity: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: '32px',
          borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.08)',
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0) 100%)',
          textDecoration: 'none',
          color: 'inherit',
          minHeight: '320px',
          position: 'relative',
          overflow: 'hidden',
          transition:
            'border-color 0.25s ease, transform 0.25s ease, background 0.25s ease',
        }}
        onMouseEnter={(e) => {
          if (!isLink) return;
          (e.currentTarget as HTMLElement).style.borderColor = p.accent;
          (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)';
        }}
        onMouseLeave={(e) => {
          if (!isLink) return;
          (e.currentTarget as HTMLElement).style.borderColor =
            'rgba(255,255,255,0.08)';
          (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
        }}
      >
        {/* Accent glow */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '180px',
            height: '180px',
            background: `radial-gradient(circle at top right, ${p.accent}24 0%, transparent 70%)`,
            pointerEvents: 'none',
          }}
        />

        {/* Status pill */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            alignSelf: 'flex-start',
            padding: '6px 12px',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: '999px',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '11px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: p.status === 'Live' ? p.accent : 'rgba(255,255,255,0.5)',
            background: p.status === 'Live' ? `${p.accent}10` : 'transparent',
            marginBottom: '20px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '999px',
              background: p.status === 'Live' ? p.accent : 'rgba(255,255,255,0.4)',
            }}
          />
          {p.status}
        </div>

        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '11px',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.5)',
            marginBottom: '8px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {p.tagline}
        </div>

        <h3
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: 'clamp(28px, 2.4vw, 36px)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: '#FFFFFF',
            margin: '0 0 16px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {p.name}
        </h3>

        <p
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: '15px',
            lineHeight: 1.6,
            color: 'rgba(255,255,255,0.65)',
            margin: 0,
            flexGrow: 1,
            position: 'relative',
            zIndex: 1,
          }}
        >
          {p.description}
        </p>

        {isLink && (
          <div
            style={{
              marginTop: '24px',
              fontFamily: "'Outfit', sans-serif",
              fontSize: '13px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: p.accent,
              position: 'relative',
              zIndex: 1,
            }}
          >
            Visit leadquik.com →
          </div>
        )}
      </Wrap>
    );
  };

  return (
    <section
      id="products"
      ref={sectionRef}
      style={{
        width: '100%',
        backgroundColor: '#0A0A0F',
        padding: 'clamp(80px, 10vw, 140px) clamp(24px, 5vw, 80px)',
      }}
    >
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        <div ref={headerRef} style={{ opacity: 0, marginBottom: '48px' }}>
          <span
            className="font-mono-label"
            style={{
              color: 'rgba(255,255,255,0.4)',
              display: 'block',
              marginBottom: '20px',
            }}
          >
            Products
          </span>
          <h2
            className="font-heading-xl"
            style={{
              color: '#FFFFFF',
              maxWidth: '760px',
              margin: 0,
            }}
          >
            Tools we build, operate, and support.
          </h2>
          <p
            style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: '17px',
              lineHeight: 1.55,
              color: 'rgba(255,255,255,0.6)',
              maxWidth: '600px',
              margin: '20px 0 0',
            }}
          >
            One product is live today. Three more are in private testing with
            our customers.
          </p>
        </div>

        <div
          ref={gridRef}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '20px',
          }}
        >
          {products.map(renderCard)}
        </div>
      </div>
    </section>
  );
}
