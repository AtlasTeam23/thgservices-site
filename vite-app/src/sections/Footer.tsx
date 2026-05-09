import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Logo from '../components/Logo';

gsap.registerPlugin(ScrollTrigger);

const navLinks = [
  { label: 'Products', anchor: '#products' },
  { label: 'Capabilities', anchor: '#capabilities' },
  { label: 'About', anchor: '#about' },
  { label: 'Contact', anchor: '#contact' },
];

export default function Footer() {
  const footerRef = useRef<HTMLElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const footer = footerRef.current;
    const cols = colsRef.current;
    if (!footer || !cols) return;

    const colElements = cols.querySelectorAll<HTMLElement>('.footer-col');

    const st = ScrollTrigger.create({
      trigger: footer,
      start: 'top 90%',
      onEnter: () => {
        gsap.fromTo(
          colElements,
          { opacity: 0, y: 20 },
          {
            opacity: 1,
            y: 0,
            duration: 0.5,
            stagger: 0.1,
            ease: 'power3.out',
          }
        );
      },
      once: true,
    });

    return () => st.kill();
  }, []);

  const linkBase: React.CSSProperties = {
    display: 'block',
    fontFamily: "'Outfit', sans-serif",
    fontSize: '16px',
    fontWeight: 400,
    color: '#FFFFFF',
    opacity: 0.7,
    textDecoration: 'none',
    lineHeight: 2.2,
    transition: 'opacity 0.3s ease',
  };

  return (
    <footer
      ref={footerRef}
      style={{
        width: '100%',
        backgroundColor: '#000000',
        padding: '80px clamp(24px, 5vw, 80px) 40px',
      }}
    >
      <div style={{ maxWidth: '1440px', margin: '0 auto' }}>
        <div
          ref={colsRef}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '48px',
          }}
        >
          {/* Brand */}
          <div className="footer-col" style={{ opacity: 0 }}>
            <div style={{ marginBottom: '14px' }}>
              <Logo size={28} />
            </div>
            <div
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontSize: '13px',
                fontWeight: 500,
                color: 'rgba(255, 255, 255, 0.55)',
                letterSpacing: '0.02em',
                marginBottom: '8px',
              }}
            >
              THG Services, LLC
            </div>
            <div
              className="font-mono-label"
              style={{ color: 'rgba(255, 255, 255, 0.4)' }}
            >
              Software · Roswell, GA
            </div>
            <div
              style={{
                marginTop: '24px',
                fontFamily: "'Outfit', sans-serif",
                fontSize: '13px',
                color: 'rgba(255,255,255,0.4)',
                lineHeight: 1.7,
              }}
            >
              D-U-N-S 12-981-2006<br />
              300 Colonial Center Pkwy<br />
              Suite 100N<br />
              Roswell, GA 30076, USA
            </div>
          </div>

          {/* Navigation */}
          <div className="footer-col" style={{ opacity: 0 }}>
            <div
              className="font-label"
              style={{
                color: 'rgba(255, 255, 255, 0.4)',
                marginBottom: '20px',
              }}
            >
              Navigation
            </div>
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.anchor}
                onClick={(e) => {
                  e.preventDefault();
                  document.querySelector(link.anchor)?.scrollIntoView({ behavior: 'smooth' });
                }}
                style={linkBase}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1'; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.7'; }}
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Legal */}
          <div className="footer-col" style={{ opacity: 0 }}>
            <div
              className="font-label"
              style={{
                color: 'rgba(255, 255, 255, 0.4)',
                marginBottom: '20px',
              }}
            >
              Legal
            </div>
            <a href="/privacy.html" style={linkBase}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.7'; }}>
              Privacy Policy
            </a>
            <a href="/privacy.html#sms-consent" style={linkBase}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.7'; }}>
              SMS / Mobile Privacy
            </a>
            <a href="/terms.html" style={linkBase}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.7'; }}>
              Terms of Service
            </a>
            <a href="/terms.html#sms-terms" style={linkBase}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.7'; }}>
              SMS Program Terms
            </a>
          </div>

          {/* Contact */}
          <div className="footer-col" style={{ opacity: 0 }}>
            <div
              className="font-label"
              style={{
                color: 'rgba(255, 255, 255, 0.4)',
                marginBottom: '20px',
              }}
            >
              Contact
            </div>
            <a href="mailto:developer@leadquik.com" style={linkBase}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.7'; }}>
              developer@leadquik.com
            </a>
            <a href="tel:+18665197993" style={linkBase}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.7'; }}>
              +1 (866) 519-7993
            </a>
            <a href="https://leadquik.com" style={linkBase}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.7'; }}>
              leadquik.com →
            </a>
          </div>
        </div>

        {/* Bottom row */}
        <div
          style={{
            marginTop: '64px',
            paddingTop: '24px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          <span
            style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: '14px',
              fontWeight: 400,
              color: 'rgba(255, 255, 255, 0.3)',
            }}
          >
            © {new Date().getFullYear()} THG Services, LLC. All rights reserved.
          </span>
          <div>
            <a
              href="/privacy.html"
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontSize: '14px',
                fontWeight: 400,
                color: 'rgba(255, 255, 255, 0.3)',
                textDecoration: 'none',
                transition: 'color 0.3s ease',
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'rgba(255, 255, 255, 0.6)'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'rgba(255, 255, 255, 0.3)'; }}
            >
              Privacy
            </a>
            <span style={{ color: 'rgba(255, 255, 255, 0.3)', margin: '0 8px' }}>·</span>
            <a
              href="/terms.html"
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontSize: '14px',
                fontWeight: 400,
                color: 'rgba(255, 255, 255, 0.3)',
                textDecoration: 'none',
                transition: 'color 0.3s ease',
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'rgba(255, 255, 255, 0.6)'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'rgba(255, 255, 255, 0.3)'; }}
            >
              Terms
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
