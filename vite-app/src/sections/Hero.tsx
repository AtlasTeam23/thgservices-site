import ProceduralGrid from '../components/ProceduralGrid';

export default function Hero() {
  return (
    <section
      id="hero"
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        backgroundColor: '#000000',
        overflow: 'hidden',
      }}
    >
      <ProceduralGrid />

      {/* Foreground content */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          padding: `0 clamp(24px, 5vw, 80px) 80px`,
        }}
      >
        <span
          className="font-mono-label"
          style={{
            color: 'rgba(255, 255, 255, 0.5)',
            marginBottom: '24px',
          }}
        >
          THG Services, LLC · Roswell, GA
        </span>
        <h1
          className="font-display"
          style={{
            color: '#FFFFFF',
            maxWidth: '1100px',
            textShadow: '0 0 80px rgba(37, 99, 235, 0.15)',
          }}
        >
          Software for businesses that run on leads.
        </h1>
        <p
          className="font-body-lg"
          style={{
            color: 'rgba(255, 255, 255, 0.6)',
            maxWidth: '560px',
            marginTop: '32px',
          }}
        >
          We design, build, and operate products that help small and mid-sized
          businesses respond faster, communicate better, and run smoother.
        </p>
      </div>

      {/* Scroll indicator */}
      <div
        style={{
          position: 'absolute',
          bottom: '40px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1,
        }}
      >
        <div
          style={{
            width: '1px',
            height: '48px',
            backgroundColor: 'rgba(255, 255, 255, 0.3)',
            animation: 'pulse 2s ease-in-out infinite',
          }}
        />
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </section>
  );
}