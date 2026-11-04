import { useLenis } from '../hooks/useLenis';
import Hero from '../sections/Hero';
import Problem from '../sections/Problem';
import Work from '../sections/Work';
import FeaturedApp from '../sections/FeaturedApp';
import Consulting from '../sections/Consulting';
import AiConcierge from '../sections/AiConcierge';
import Capabilities from '../sections/Capabilities';
import About from '../sections/About';
import BrandArc from '../sections/BrandArc';
import Footer from '../sections/Footer';
import FromEstimateWelcome from '../components/FromEstimateWelcome';

export default function Home({ fromEstimate = false }: { fromEstimate?: boolean }) {
  useLenis();

  return (
    <>
      <main>
        {fromEstimate && <FromEstimateWelcome />}
        <Hero />
        <AiConcierge />
        <Work />
        <FeaturedApp />
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
