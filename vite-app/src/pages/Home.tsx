import { useLenis } from '../hooks/useLenis';
import Navigation from '../components/Navigation';
import Hero from '../sections/Hero';
import Problem from '../sections/Problem';
import Work from '../sections/Work';
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
        <Work />
        <Problem />
        <Capabilities />
        <About />
        <BrandArc />
      </main>
      <Footer />
    </>
  );
}
