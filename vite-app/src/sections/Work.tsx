import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

type Product = {
  name: string;
  category: 'Live' | 'In Development';
  tagline: string;
  description: string;
  gradient: string;
};

const products: Product[] = [
  {
    name: 'LeadQuik',
    category: 'Live',
    tagline: 'Lead Response Platform',
    description:
      'The instant a new lead comes in, LeadQuik replies in seconds with AI-driven first-touch and human fallback so no opportunity goes cold. Used by businesses across services, professional, and retail categories.',
    gradient:
      'linear-gradient(135deg, rgba(37,99,235,0.20) 0%, rgba(37,99,235,0.05) 60%, rgba(0,0,0,0) 100%)',
  },
  {
    name: 'Atlas',
    category: 'In Development',
    tagline: 'Field Operations & Customer Comms',
    description:
      'Field operations and customer communication tools for service businesses. Currently in private testing with select customers.',
    gradient:
      'linear-gradient(135deg, rgba(245,158,11,0.20) 0%, rgba(245,158,11,0.05) 60%, rgba(0,0,0,0) 100%)',
  },
  {
    name: 'CashPulse',
    category: 'In Development',
    tagline: 'Cash Flow Visibility',
    description:
      'Cash flow visibility and financial tooling for owner-operators. Currently in private testing.',
    gradient:
      'linear-gradient(135deg, rgba(16,185,129,0.20) 0%, rgba(16,185,129,0.05) 60%, rgba(0,0,0,0) 100%)',
  },
  {
    name: 'Blaze',
    category: 'In Development',
    tagline: 'Marketing & Outreach Automation',
    description:
      'Marketing and outreach automation for small business teams. Currently in private testing.',
    gradient:
      'linear-gradient(135deg, rgba(239,68,68,0.20) 0%, rgba(239,68,68,0.05) 60%, rgba(0,0,0,0) 100%)',
  },
];

export default function Work() {
  const sectionRef = useRef<HTMLElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef({ current: 0, target: 0 });

  useEffect(() => {
    const section = sectionRef.current;
    const wrapper = wrapperRef.current;
    const header = headerRef.current;
    if (!section || !wrapper || !header) return;

    const headerSt = ScrollTrigger.create({
      trigger: section,
      start: 'top 80%',
      onEnter: () => {
        gsap.fromTo(
          header,
          { opacity: 0, y: 30 },
          { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }
        );
      },
      once: true,
    });

    const getScrollWidth = () => wrapper.scrollWidth - window.innerWidth;

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: section,
        start: 'top top',
        end: () => `+=${getScrollWidth() + window.innerHeight}`,
        pin: true,
        scrub: 1,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      },
    });

    tl.fromTo(
      wrapper,
      { x: 0 },
      {
        x: () => -getScrollWidth(),
        ease: 'none',
        onUpdate: function () {
          const progress = this.progress();
          const targetX = -getScrollWidth() * progress;
          speedRef.current.target = targetX - speedRef.current.current;
          speedRef.current.current +=
            (speedRef.current.target - speedRef.current.current) * 0.1;

          const skewAmount = speedRef.current.current * 0.08;
          const cards = wrapper.querySelectorAll<HTMLElement>('.work-card');
          cards.forEach((card) => {
            card.style.transform = `skewX(${Math.max(
              -8,
              Math.min(8, skewAmount)
            )}deg)`;
          });
        },
      }
    );

    return () => {
      headerSt.kill();
      tl.kill();
      ScrollTrigger.getAll()
        .filter((st) => st.trigger === section)
        .forEach((st) => st.kill());
    };
  }, []);

  return (
    <section
      id="products"
      ref={sectionRef}
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: '#000000',
      }}
    >
      <div
        ref={headerRef}
        className="page-margin"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          paddingTop: '40px',
          zIndex: 2,
          opacity: 0,
        }}
      >
        <span
          className="font-mono-label"
          style={{
            color: 'rgba(255, 255, 255, 0.4)',
            display: 'block',
            marginBottom: '16px',
          }}
        >
          Our Products
        </span>
        <h2
          className="font-heading-xl"
          style={{
            color: '#FFFFFF',
            maxWidth: '900px',
          }}
        >
          Tools we build, operate, and support.
        </h2>
      </div>

      <div
        ref={wrapperRef}
        style={{
          display: 'flex',
          gap: '2vw',
          alignItems: 'center',
          height: '100%',
          paddingLeft: 'clamp(24px, 5vw, 80px)',
          paddingRight: 'clamp(24px, 5vw, 80px)',
          paddingTop: '120px',
          willChange: 'transform',
        }}
      >
        {products.map((product) => (
          <div
            key={product.name}
            className="work-card"
            style={{
              flexShrink: 0,
              width: 'min(500px, 80vw)',
              height: '65vh',
              position: 'relative',
              overflow: 'hidden',
              borderRadius: 0,
              cursor: 'default',
              transition: 'transform 0.4s ease',
              transformOrigin: 'center center',
              border: '1px solid rgba(255,255,255,0.08)',
              background: '#0A0A0F',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: product.gradient,
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                padding: '32px',
                zIndex: 1,
              }}
            >
              <span
                className="font-label"
                style={{
                  display: 'inline-block',
                  padding: '6px 12px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '999px',
                  color:
                    product.category === 'Live'
                      ? 'rgba(37,99,235,0.95)'
                      : 'rgba(255,255,255,0.55)',
                  fontSize: '11px',
                  letterSpacing: '0.12em',
                }}
              >
                {product.category}
              </span>
            </div>
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                padding: '32px',
                zIndex: 1,
              }}
            >
              <span
                className="font-label"
                style={{
                  color: 'rgba(255, 255, 255, 0.55)',
                  display: 'block',
                  marginBottom: '8px',
                }}
              >
                {product.tagline}
              </span>
              <h3
                className="font-heading-lg"
                style={{ color: '#FFFFFF', marginBottom: '16px' }}
              >
                {product.name}
              </h3>
              <p
                className="font-body"
                style={{
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: '15px',
                  lineHeight: 1.55,
                }}
              >
                {product.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
