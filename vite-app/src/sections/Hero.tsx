import GalaxyBackground from '../components/GalaxyBackground';

export default function Hero() {
  return (
    <section
      id="hero"
      className="hero-section"
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '100vh',
        backgroundColor: '#04050A',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      {/* Animated galaxy starfield */}
      <GalaxyBackground />

      {/* Subtle vignette so headline keeps contrast in the brightest galaxy area */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg, rgba(4,5,10,0.6) 0%, rgba(4,5,10,0.15) 45%, rgba(4,5,10,0) 100%), linear-gradient(180deg, rgba(4,5,10,0.4) 0%, rgba(4,5,10,0) 30%, rgba(4,5,10,0) 70%, rgba(4,5,10,0.6) 100%)',
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
          padding: 'clamp(96px, 14vw, 120px) clamp(24px, 5vw, 80px) clamp(64px, 12vw, 96px)',
        }}
      >
        <span
          className="font-mono-label"
          style={{
            color: 'rgba(255, 255, 255, 0.55)',
            display: 'block',
            marginBottom: '28px',
          }}
        >
          THG Services, LLC · Roswell, GA
        </span>

        <h1
          className="font-display"
          style={{
            color: '#FFFFFF',
            maxWidth: '900px',
            margin: 0,
          }}
        >
          Software for businesses that run on leads.
        </h1>

        <p
          className="font-body-lg"
          style={{
            color: 'rgba(255, 255, 255, 0.65)',
            maxWidth: '640px',
            marginTop: '28px',
            fontSize: 'clamp(17px, 1.5vw, 20px)',
            lineHeight: 1.55,
          }}
        >
          We build and operate products that help small and mid-sized
          businesses respond to inbound leads in seconds, unify their
          customer communications, and run their day-to-day operations.
          One product is live. Three more are in private testing.
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
              color: '#FFFFFF',
              border: '1px solid rgba(255,255,255,0.18)',
              fontFamily: "'Outfit', sans-serif",
              fontSize: '14px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              transition: 'border-color 0.2s ease, background-color 0.2s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.45)';
              (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.04)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.18)';
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
            backgroundColor: 'rgba(255, 255, 255, 0.25)',
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
