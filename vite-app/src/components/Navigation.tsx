import { useEffect, useRef, useState } from 'react';

const navLinks = [
  { label: 'Why', href: '#why' },
  { label: 'Products', href: '#products' },
  { label: 'Capabilities', href: '#capabilities' },
  { label: 'About', href: '#about' },
  { label: 'Contact', href: '#contact' },
];

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > window.innerHeight * 0.5);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    const el = document.querySelector(href);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
    setMenuOpen(false);
  };

  return (
    <>
      <nav
        ref={navRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '72px',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 clamp(24px, 5vw, 80px)',
          transition: 'background-color 0.4s ease, backdrop-filter 0.4s ease',
          backgroundColor: scrolled ? 'rgba(0, 0, 0, 0.85)' : 'transparent',
          backdropFilter: scrolled ? 'blur(12px)' : 'none',
          WebkitBackdropFilter: scrolled ? 'blur(12px)' : 'none',
        }}
      >
        {/* Brand */}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: '18px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: '#FFFFFF',
            textTransform: 'uppercase' as const,
            textDecoration: 'none',
          }}
        >
          THG Services
        </a>

        {/* Center links - desktop */}
        <div
          style={{
            display: 'flex',
            gap: '40px',
            alignItems: 'center',
          }}
          className="hidden md:flex"
        >
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={(e) => handleNavClick(e, link.href)}
              className="font-nav"
              style={{
                color: '#FFFFFF',
                opacity: 0.7,
                textDecoration: 'none',
                transition: 'opacity 0.3s ease',
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.opacity = '1';
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.opacity = '0.7';
              }}
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* CTA - desktop */}
        <a
          href="#contact"
          onClick={(e) => handleNavClick(e, '#contact')}
          className="hidden md:inline-flex"
          style={{
            height: '40px',
            borderRadius: '20px',
            padding: '0 24px',
            backgroundColor: '#2563EB',
            color: '#FFFFFF',
            fontFamily: "'Outfit', sans-serif",
            fontSize: '14px',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase' as const,
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background-color 0.3s ease',
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.backgroundColor = '#1E40AF';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.backgroundColor = '#2563EB';
          }}
        >
          Contact Us
        </a>

        {/* Mobile hamburger */}
        <button
          className="md:hidden"
          onClick={() => setMenuOpen(!menuOpen)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '8px',
          }}
          aria-label="Toggle menu"
        >
          <div style={{ width: 24, height: 2, background: '#fff', marginBottom: 6, transition: 'transform 0.3s', transform: menuOpen ? 'rotate(45deg) translate(4px, 4px)' : 'none' }} />
          <div style={{ width: 24, height: 2, background: '#fff', marginBottom: 6, opacity: menuOpen ? 0 : 1, transition: 'opacity 0.3s' }} />
          <div style={{ width: 24, height: 2, background: '#fff', transition: 'transform 0.3s', transform: menuOpen ? 'rotate(-45deg) translate(4px, -4px)' : 'none' }} />
        </button>
      </nav>

      {/* Mobile overlay */}
      {menuOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99,
            backgroundColor: 'rgba(0, 0, 0, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '32px',
          }}
        >
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={(e) => handleNavClick(e, link.href)}
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontSize: '32px',
                fontWeight: 600,
                color: '#FFFFFF',
                textDecoration: 'none',
                letterSpacing: '-0.02em',
              }}
            >
              {link.label}
            </a>
          ))}
          <a
            href="#contact"
            onClick={(e) => handleNavClick(e, '#contact')}
            style={{
              marginTop: '24px',
              height: '48px',
              borderRadius: '24px',
              padding: '0 32px',
              backgroundColor: '#2563EB',
              color: '#FFFFFF',
              fontFamily: "'Outfit', sans-serif",
              fontSize: '14px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase' as const,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            Start a Project
          </a>
        </div>
      )}
    </>
  );
}