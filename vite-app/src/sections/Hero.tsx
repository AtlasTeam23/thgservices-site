export default function Hero() {
  return (
    <section
      id="hero"
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '100vh',
        backgroundColor: '#0A0A0F',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      {/* Subtle radial gradient accent */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 70% 60% at 80% 20%, rgba(37, 99, 235, 0.08) 0%, rgba(37, 99, 235, 0) 60%), radial-gradient(ellipse 50% 50% at 10% 100%, rgba(245, 158, 11, 0.04) 0%, rgba(245, 158, 11, 0) 60%)',
          pointerEvents: 'none',
        }}
      />

      {/* Faint dot grid */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage:
            'radial-gradient(ellipse 80% 80% at 50% 50%, #000 35%, transparent 80%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 80% 80% at 50% 50%, #000 35%, transparent 80%)',
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
          padding: '120px clamp(24px, 5vw, 80px) 96px',
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
            maxWidth: '880px',
            margin: 0,
          }}
        >
          Software for businesses that run on leads.
        </h1>

        <p
          className="font-body-lg"
          style={{
            color: 'rgba(255, 255, 255, 0.65)',
            maxWidth: '600px',
            marginTop: '28px',
            fontSize: 'clamp(17px, 1.5vw, 20px)',
            lineHeight: 1.55,
          }}
        >
          We design, build, and operate products that help small and mid-sized
          businesses respond faster, communicate better, and run smoother.
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
        @media (prefers-reduced-motion: reduce) {
          @keyframes heroPulse {
            0%, 100% { opacity: 0.4; transform: none; }
          }
        }
      `}</style>
    </section>
  );
}
