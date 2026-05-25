import GalaxyBackground from '../components/GalaxyBackground';
import AuroraBackground from '../components/AuroraBackground';
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
      {/* Background: starfield in dark mode, aurora gradient in light mode */}
      {theme === 'dark' ? <GalaxyBackground /> : <AuroraBackground />}

      {/* Subtle vignette so headline keeps contrast over the background */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg, var(--thg-vignette-left) 0%, var(--thg-vignette-mid) 45%, var(--thg-vignette-end) 100%), linear-gradient(180deg, var(--thg-vignette-top) 0%, var(--thg-vignette-end) 30%, var(--thg-vignette-end) 70%, var(--thg-vignette-bottom) 100%)',
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
        <span
          className="font-mono-label"
          style={{
            color: 'var(--thg-text-tertiary)',
            display: 'block',
            marginBottom: '28px',
          }}
        >
          THG Services, LLC · Roswell, GA
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
          THG Services is the software studio of a 25-year entrepreneur — a
          multi-state operator who&rsquo;s been running companies since long
          before the apps existed. LeadQuik, Atlas, and Blaze are our
          flagship products, with more in the pipeline. We also build apps
          for clients on request, and take on custom work when the
          off-the-shelf software can&rsquo;t get the job done.
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
