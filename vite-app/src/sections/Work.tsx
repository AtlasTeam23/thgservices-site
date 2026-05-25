import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

type Product = {
  name: string;
  status:
    | 'Live'
    | 'In development'
    | 'Beta'
    | 'Available'
    | 'Client app';
  tagline: string;
  description: string;
  href?: string;
  cta?: { label: string; href: string };
  accent: string;
};

const products: Product[] = [
  {
    name: 'LeadQuik',
    status: 'Live',
    tagline: 'Lead response platform',
    description:
      'Our flagship daily driver. Four apps in one — AI lead response in seconds, conversation routing, unified customer comms, and conversion tracking across Google Ads. Used by businesses across services, professional, and retail categories.',
    href: 'https://leadquik.com',
    accent: '#2563EB',
  },
  {
    name: 'Atlas',
    status: 'In development',
    tagline: 'Estimating & CRM for service businesses',
    description:
      'Estimating, project management, and customer relationship tools for service businesses — built on 25 years of running multi-state operations. Currently in private testing with select customers.',
    accent: '#F97316',
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
    tagline: 'AI SEO & ad-spend agent',
    description:
      "An AI agent that commands your Google Ads spend, built on 15+ years of AdWords expertise. In some cases we've saved customers $80K a year while tripling return on ad spend. Currently in private testing.",
    accent: '#EF4444',
  },
  {
    name: 'Bella Beast',
    status: 'Client app',
    tagline: 'Fitness coaching with Coach Adriana',
    description:
      'Train hard. Eat right. Be the beast. A coaching brand and app from Coach Adriana for clients who want a real plan, not a generic one. Currently in beta.',
    href: 'https://bellabeast.com',
    accent: '#009C3B',
  },
  {
    name: 'Memory Lane',
    status: 'Client app',
    tagline: 'Photo & image restoration',
    description:
      'Bring old photos back to life. Memory Lane uses AI to restore faded, damaged, and low-resolution images so the memories stay as sharp as the moment.',
    href: 'https://photomemorylane.com',
    accent: '#D97706',
  },
  {
    name: 'Your App',
    status: 'Available',
    tagline: 'Build with our team',
    description:
      'Contact us to discuss making your own app for your business. We have teams ready to help build your project.',
    cta: { label: 'Start a Conversation', href: '#contact' },
    accent: '#8B5CF6',
  },
];

const accentStatuses: Product['status'][] = ['Live', 'Beta', 'Available'];

// Neutral blue-grey palette for client-work cards so the pill reads
// informational instead of branded.
const CLIENT_PILL_COLOR = '#94A3B8'; // slate-400
const CLIENT_PILL_BG = 'rgba(148, 163, 184, 0.10)';

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
          border: '1px solid var(--thg-border-subtle)',
          background:
            'linear-gradient(180deg, var(--thg-bg-elevated) 0%, transparent 100%)',
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
            'var(--thg-border-subtle)';
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
            border: '1px solid var(--thg-border-subtle)',
            borderRadius: '999px',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '11px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color:
              p.status === 'Client app'
                ? CLIENT_PILL_COLOR
                : accentStatuses.includes(p.status)
                  ? p.accent
                  : 'var(--thg-text-tertiary)',
            background:
              p.status === 'Client app'
                ? CLIENT_PILL_BG
                : accentStatuses.includes(p.status)
                  ? `${p.accent}10`
                  : 'transparent',
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
              background:
                p.status === 'Client app'
                  ? CLIENT_PILL_COLOR
                  : accentStatuses.includes(p.status)
                    ? p.accent
                    : 'var(--thg-text-quaternary)',
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
            color: 'var(--thg-text-tertiary)',
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
            color: 'var(--thg-text-primary)',
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
            color: 'var(--thg-text-secondary)',
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
            Visit {p.href!.replace(/^https?:\/\//, '').replace(/\/$/, '')} →
          </div>
        )}

        {p.cta && (
          <a
            href={p.cta.href}
            onClick={(e) => {
              if (p.cta!.href.startsWith('#')) {
                e.preventDefault();
                document
                  .querySelector(p.cta!.href)
                  ?.scrollIntoView({ behavior: 'smooth' });
              }
            }}
            style={{
              alignSelf: 'flex-start',
              marginTop: '24px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '44px',
              padding: '0 22px',
              borderRadius: '22px',
              backgroundColor: p.accent,
              color: '#FFFFFF',
              fontFamily: "'Outfit', sans-serif",
              fontSize: '13px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              transition: 'filter 0.2s ease, transform 0.2s ease',
              position: 'relative',
              zIndex: 1,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.filter = 'brightness(1.12)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.filter = 'brightness(1)';
            }}
          >
            {p.cta.label} →
          </a>
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
        backgroundColor: 'var(--thg-bg-section)',
        padding: 'clamp(80px, 10vw, 140px) clamp(24px, 5vw, 80px)',
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
            Products
          </span>
          <h2
            className="font-heading-xl"
            style={{
              color: 'var(--thg-text-primary)',
              maxWidth: '760px',
              margin: 0,
            }}
          >
            Three flagship products. More in the pipeline. Plus apps built
            for clients.
          </h2>
          <p
            style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: '17px',
              lineHeight: 1.6,
              color: 'var(--thg-text-secondary)',
              maxWidth: '640px',
              margin: '20px 0 0',
            }}
          >
            We build, operate, and support our own product line — and take
            on custom builds when an existing tool can’t get the job done.
            We don’t white-label other people’s software, and we don’t ship
            anything we wouldn’t use ourselves.
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
