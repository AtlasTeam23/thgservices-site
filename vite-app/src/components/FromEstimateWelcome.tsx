import './FromEstimateWelcome.css';

/**
 * Slim welcome band for visitors who arrive from a LeadQuik estimate link
 * (/from-estimate). No prices and nothing from the URL is shown.
 */
export default function FromEstimateWelcome() {
  return (
    <section className="thg-fe-band" aria-labelledby="thg-fe-eyebrow">
      <div className="thg-fe-inner">
        <div className="thg-fe-copy">
          <span id="thg-fe-eyebrow" className="font-mono-label thg-fe-eyebrow">
            From your estimate
          </span>
          <p className="thg-fe-text">
            Thanks for reviewing your estimate. Here's how THG AI Services helps local
            businesses like yours run smoother.
          </p>
        </div>
        <a
          className="thg-fe-link"
          href="#ai-concierge"
          onClick={(e) => {
            e.preventDefault();
            document.querySelector('#ai-concierge')?.scrollIntoView({ behavior: 'smooth' });
          }}
        >
          See how we work ↓
        </a>
      </div>
    </section>
  );
}
