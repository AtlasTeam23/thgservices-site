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
  appStoreHref?: string;
  cta?: { label: string; href: string };
  accent: string;
};

const products: Product[] = [
  {
    name: 'LeadQuik CRM',
    status: 'Live',
    tagline: 'Lead response, estimating & CRM — all in one',
    description:
      'Our flagship daily driver. AI lead response in seconds, conversation routing, unified customer comms, estimating, project management, and Google Ads conversion tracking — one app for service, professional, and retail businesses. Built on 25 years of running multi-state operations.',
    href: 'https://leadquik.com',
    appStoreHref: 'https://apps.apple.com/app/leadquik-leads-jobs-crm/id6797596704',
    accent: '#2563EB',
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
    name: 'Blast Lands',
    status: 'Beta',
    tagline: 'All-ages desert battle royale',
    description:
      'Drop in, grab loot, survive the sands. A vibrant battle royale set in a shifting desert world — meet Rio and the squad, dodge the sand creatures, and outlast the closing storm. iOS, Android, and web.',
    href: 'https://blastlands.com',
    accent: '#DB2777',
  },
  {
    name: 'Highlights Reel',
    status: 'Beta',
    tagline: 'Recruiting profiles for athletes',
    description:
      'Recruiting profiles for club and high school athletes — highlights, game breakdowns, academics, and contact in one shareable page built for recruiters.',
    href: 'https://highlightsreel.com',
    accent: '#06B6D4',
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
    name: 'CashPulse',
    status: 'In development',
    tagline: 'Cash flow visibility',
    description:
      'Cash flow visibility and financial tooling for owner-operators. Currently in private testing.',
    accent: '#10B981',
  },
  {
    name: 'Blaze',
    status: 'Live',
    tagline: 'AI SEO & ad-spend agent',
    description:
      "An AI agent that commands your Google Ads spend, built on 15+ years of AdWords expertise. In some cases we've saved customers $80K a year while tripling return on ad spend.",
    accent: '#EF4444',
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
          border: '1px solid var(--thg-bg-work-card-border)',
          background: 'var(--thg-bg-work-card)',
          textDecoration: 'none',
          color: 'inherit',
          minHeight: '320px',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: 'none',
          transition:
            'border-color 0.25s ease, transform 0.25s ease, box-shadow 0.25s ease',
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.borderColor = p.accent;
          el.style.transform = 'translateY(-6px)';
          el.style.boxShadow = 'var(--thg-work-card-shadow-hover)';
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.borderColor = 'var(--thg-bg-work-card-border)';
          el.style.transform = 'translateY(0)';
          el.style.boxShadow = 'none';
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
            lineHeight: 1.4,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--thg-text-tertiary)',
            marginBottom: '8px',
            // Reserve 2 lines so single-line taglines align with two-line
            // ones across the row (keeps the product name baseline-aligned)
            minHeight: 'calc(11px * 1.4 * 2)',
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
            // Reserve enough vertical space for the longest description
            // (~7 lines) so cards stay uniform height across all rows and
            // visit-links / CTAs end up baseline-aligned.
            minHeight: 'calc(15px * 1.6 * 7)',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {p.description}
        </p>

        {(isLink || p.appStoreHref) && (
          <div
            style={{
              marginTop: '24px',
              display: 'flex',
              gap: '18px',
              flexWrap: 'wrap',
              alignItems: 'center',
              position: 'relative',
              zIndex: 1,
            }}
          >
            {isLink && (
              <span
                style={{
                  fontFamily: "'Outfit', sans-serif",
                  fontSize: '13px',
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: p.accent,
                }}
              >
                Visit {p.href!.replace(/^https?:\/\//, '').replace(/\/$/, '')} →
              </span>
            )}
            {p.appStoreHref && (
              <a
                href={p.appStoreHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontFamily: "'Outfit', sans-serif",
                  fontSize: '13px',
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: p.accent,
                  textDecoration: 'none',
                }}
              >
                <svg
                  width="12"
                  height="14"
                  viewBox="0 0 384 512"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
                </svg>
                App Store →
              </a>
            )}
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
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: 'var(--thg-bg-section-emphasis)',
        padding: 'clamp(80px, 10vw, 140px) clamp(24px, 5vw, 80px)',
        transition: 'background-color 0.3s ease',
      }}
    >
      {/* Texture: radial glows in opposing corners + faint dot grid.
          White-alpha values read on both #0A0A0F (dark) and #0F172A
          (light-mode charcoal). */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage: [
            'radial-gradient(ellipse 70% 55% at 92% 8%, var(--thg-work-glow-tr) 0%, transparent 60%)',
            'radial-gradient(ellipse 55% 45% at 8% 95%, var(--thg-work-glow-bl) 0%, transparent 55%)',
            'radial-gradient(circle, var(--thg-work-dot) 1px, transparent 1px)',
          ].join(', '),
          backgroundSize: '100% 100%, 100% 100%, 32px 32px',
          backgroundPosition: '0 0, 0 0, 0 0',
          maskImage:
            'linear-gradient(to bottom, transparent 0%, #000 8%, #000 92%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, #000 8%, #000 92%, transparent 100%)',
        }}
      />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          maxWidth: '1280px',
          margin: '0 auto',
        }}
      >
        <div ref={headerRef} style={{ opacity: 0, marginBottom: '48px' }}>
          <span
            className="font-mono-label"
            style={{
              color: 'rgba(255, 255, 255, 0.5)',
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
            Three flagship products live. More in the pipeline. Plus apps
            built for clients.
          </h2>
          <p
            style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: '17px',
              lineHeight: 1.6,
              color: 'rgba(255, 255, 255, 0.7)',
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

        {/* "Real business using our software" visual anchor.
            Border uses a literal rgba — Work's bg is #0F172A in both themes
            (emphasis variant), and --thg-border-subtle flips to slate-alpha
            in light mode which disappears on this bg. */}
        <div
          style={{
            marginBottom: '48px',
            borderRadius: '12px',
            overflow: 'hidden',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            aspectRatio: '16 / 9',
            maxHeight: '480px',
          }}
        >
          <img
            src="/photos/work-shop-owner-tablet.jpg"
            alt="Shop owner behind a counter, focused on a register-mounted tablet"
            loading="lazy"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
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
