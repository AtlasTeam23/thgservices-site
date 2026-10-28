import AuroraBackground from '../components/AuroraBackground';
import BrandLogo from '../components/BrandLogo';
import { useTheme } from '../lib/theme';

export default function Hero() {
  const { theme } = useTheme();

  return (
    <section
      id="hero"
      className="hero-section"
      style={{
        position: 'relative',
        width: '100%',
        minHeight: 'min(86vh, 760px)',
        backgroundColor: 'var(--thg-bg-page)',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'flex-start',
        transition: 'background-color 0.3s ease',
      }}
    >
      {/* Background: boardroom-at-dusk photo backdrop in dark mode,
          aurora gradient in light mode. Vignette overlay (below) tames
          the photo for text contrast. */}
      {theme === 'dark' ? (
        <img
          src="/photos/hero-boardroom-dusk.jpg"
          alt=""
          aria-hidden="true"
          loading="eager"
          fetchPriority="high"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        <AuroraBackground />
      )}

      {/* Subtle vignette so headline keeps contrast over the background */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg, var(--thg-vignette-left) 0%, var(--thg-vignette-mid) 60%, var(--thg-vignette-end) 100%), linear-gradient(180deg, var(--thg-vignette-top) 0%, var(--thg-vignette-end) 30%, var(--thg-vignette-end) 70%, var(--thg-vignette-bottom) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Foreground content */}
      <div
        className="page-margin"
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: '1280px',
          margin: '0 auto',
          padding: 'clamp(96px, 14vw, 120px) clamp(24px, 5vw, 80px) clamp(48px, 8vw, 64px)',
        }}
      >
        {/* Prominent brand mark — the new THG / AI SERVICES wordmark.
            In dark mode we use the transparent cut-out so the letters sit
            right on the boardroom photo. In light mode the aurora
            background can wash out white letters, so we fall back to the
            dark-letters variant of the standalone BrandLogo. */}
        {theme === 'dark' ? (
          <img
            src="/thg-ai-logo-mark-transparent.png"
            alt="THG AI Services"
            width={1200}
            height={460}
            style={{
              display: 'block',
              width: 'min(640px, 85%)',
              height: 'auto',
              marginBottom: '36px',
              marginLeft: 0,
            }}
          />
        ) : (
          <div style={{ marginBottom: '36px' }}>
            <BrandLogo variant="dark-letters" size={260} />
          </div>
        )}

        <span
          className="font-mono-label"
          style={{
            color: 'var(--thg-text-tertiary)',
            display: 'block',
            marginBottom: '28px',
          }}
        >
          Woodstock, GA
        </span>

        <h1
          className="font-display"
          style={{
            color: 'var(--thg-text-primary)',
            maxWidth: '900px',
            margin: 0,
          }}
        >
          Software built by an operator, not a vendor.
        </h1>

        <p
          className="font-body-lg"
          style={{
            color: 'var(--thg-text-secondary)',
            maxWidth: '640px',
            marginTop: '28px',
            fontSize: 'clamp(17px, 1.5vw, 20px)',
            lineHeight: 1.55,
          }}
        >
          THG AI Services is the software studio of a 25-year entrepreneur
          — a multi-state operator who&rsquo;s been running companies since
          long before the apps existed. LeadQuik is our flagship, with
          more products in the pipeline. We also build apps for clients
          on request, and take on custom work when the off-the-shelf
          software can&rsquo;t get the job done.
        </p>

        <div
          style={{
            display: 'flex',
            gap: '12px',
            marginTop: '40px',
            flexWrap: 'wrap',
          }}
        >
          <a
            href="#products"
            onClick={(e) => {
              e.preventDefault();
              document
                .querySelector('#products')
                ?.scrollIntoView({ behavior: 'smooth' });
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '48px',
              padding: '0 24px',
              borderRadius: '24px',
              backgroundColor: '#2563EB',
              color: '#FFFFFF',
              fontFamily: "'Outfit', sans-serif",
              fontSize: '14px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              transition: 'background-color 0.2s ease, transform 0.2s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = '#1E40AF';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = '#2563EB';
            }}
          >
            Our Products
          </a>
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
              padding: '0 24px',
              borderRadius: '24px',
              backgroundColor: 'transparent',
              color: 'var(--thg-text-primary)',
              border: '1px solid var(--thg-border-medium)',
              fontFamily: "'Outfit', sans-serif",
              fontSize: '14px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              transition: 'border-color 0.2s ease, background-color 0.2s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--thg-border-strong)';
              (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--thg-bg-elevated-strong)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--thg-border-medium)';
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            }}
          >
            Contact Us
          </a>
        </div>
      </div>

      {/* Scroll indicator */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: '32px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1,
        }}
      >
        <div
          style={{
            width: '1px',
            height: '40px',
            backgroundColor: 'var(--thg-text-quinary)',
            animation: 'heroPulse 2.4s ease-in-out infinite',
          }}
        />
      </div>

      <style>{`
        @keyframes heroPulse {
          0%, 100% { opacity: 0.25; transform: translateY(0); }
          50% { opacity: 0.55; transform: translateY(4px); }
        }
        @media (max-width: 768px) {
          .hero-section {
            align-items: flex-start !important;
            min-height: auto !important;
          }
          /* Darken the backdrop photo on phones — center crop puts the
             laptop glow right under the body paragraph, pushing text
             contrast under AA. */
          .hero-section > img {
            filter: brightness(0.7);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes heroPulse {
            0%, 100% { opacity: 0.4; transform: none; }
          }
        }
      `}</style>
    </section>
  );
}
