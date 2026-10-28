import { useLenis } from '../hooks/useLenis';
import Navigation from '../components/Navigation';
import Hero from '../sections/Hero';
import Problem from '../sections/Problem';
import Work from '../sections/Work';
import Consulting from '../sections/Consulting';
import Capabilities from '../sections/Capabilities';
import About from '../sections/About';
import BrandArc from '../sections/BrandArc';
import Footer from '../sections/Footer';

export default function Home() {
  useLenis();

  return (
    <>
      <Navigation />
      <main>
        <Hero />
        {/* Mood band — operators at work, transitions from the dark hero.
            Rendered eagerly / high-priority because on phones (where the hero
            collapses to min-height:auto) this band sits inside the first
            viewport and will be the LCP element. */}
        <section
          style={{
            width: '100%',
            backgroundColor: 'var(--thg-bg-page)',
            overflow: 'hidden',
            borderTop: '1px solid var(--thg-bg-section-border)',
            borderBottom: '1px solid var(--thg-bg-section-border)',
          }}
        >
          <img
            src="/photos/hero-boardroom-dusk.jpg"
            alt="Four people around a long table at dusk, lit by laptops, blue-hour windows behind"
            loading="eager"
            fetchPriority="high"
            style={{
              width: '100%',
              height: 'clamp(220px, 32vw, 420px)',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </section>
        <Work />
        <Consulting />
        <Problem />
        <Capabilities />
        <About />
        <BrandArc />
      </main>
      <Footer />
    </>
  );
}
