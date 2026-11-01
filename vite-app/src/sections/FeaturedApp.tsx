import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import AppStoreBadge from '../components/AppStoreBadge';
import { useTheme } from '../lib/theme';

gsap.registerPlugin(ScrollTrigger);

const BELLA_BEAST_APP_STORE =
  'https://apps.apple.com/us/app/bella-beast/id6825593814';

export default function FeaturedApp() {
  const { theme } = useTheme();
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const content = contentRef.current;
    if (!section || !content) return;

    const st = ScrollTrigger.create({
      trigger: section,
      start: 'top 80%',
      once: true,
      onEnter: () => {
        gsap.fromTo(
          content,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.65, ease: 'power3.out' }
        );
      },
    });

    return () => st.kill();
  }, []);

  return (
    <section
      id="bella-beast"
      ref={sectionRef}
      style={{
        width: '100%',
        backgroundColor: 'var(--thg-bg-section)',
        padding: 'clamp(56px, 7vw, 88px) clamp(24px, 5vw, 80px)',
        borderTop: '1px solid var(--thg-bg-section-border)',
        transition: 'background-color 0.3s ease',
      }}
    >
      <div
        ref={contentRef}
        style={{
          opacity: 0,
          maxWidth: '640px',
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        <span
          className="font-mono-label"
          style={{
            color: 'var(--thg-text-quaternary)',
            display: 'block',
            marginBottom: '16px',
          }}
        >
          Now on the App Store
        </span>
        <h2
          className="font-heading-md"
          style={{
            color: 'var(--thg-text-primary)',
            margin: '0 0 16px',
          }}
        >
          Built by THG AI Services
        </h2>
        <p
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: '17px',
            lineHeight: 1.6,
            color: 'var(--thg-text-secondary)',
            margin: '0 0 24px',
          }}
        >
          We helped build Bella Beast, a fitness app now live on the App
          Store.
        </p>
        {/* Official black badge needs a light plate in dark mode so it
            stays readable without altering Apple's artwork. */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: theme === 'dark' ? '#FFFFFF' : 'transparent',
            borderRadius: theme === 'dark' ? '10px' : 0,
          }}
        >
          <AppStoreBadge href={BELLA_BEAST_APP_STORE} />
        </div>
      </div>
    </section>
  );
}
