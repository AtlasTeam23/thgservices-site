import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { isConciergeEnabled, openConcierge } from '../components/concierge';
import {
  DISCLOSURE,
  GREETING,
  OFFER_CHIPS,
  PANEL_TITLE,
  PHONE_DISPLAY,
  PHONE_HREF,
} from '../components/concierge/copy';
import { useMediaQuery } from '../components/concierge/useMediaQuery';
import { track } from '../lib/track';

gsap.registerPlugin(ScrollTrigger);

const bullets = [
  'Answers questions about your business, day or night',
  'Collects name, phone, and what they need',
  'Sets up callbacks so your team follows up',
];

// What the preview card "says". It only uses wording the real widget already has.
const PREVIEW_QUESTION = 'What do you do?';
const PREVIEW_ANSWER =
  'We sit down with local business owners, learn how your day actually runs, and fix the busywork with the right mix of software and AI tools. Want me to have someone call you?';

// "Try it now" and the preview card ask for exactly the same thing.
const TRY_REQUEST = { source: 'section_cta', quickReply: 'Try the AI Concierge' } as const;
const openTryChat = () => openConcierge(TRY_REQUEST);

// The card is desktop-only (see the .aic-card-wrap CSS below). Phones never get the clip.
const DESKTOP_QUERY = '(min-width: 900px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// The clip is cropped to the card's outer border (792 x 946 px), so this box is exactly the card:
// it fills the button (the card's width) and has the card's corner radius. Its background is the
// card surface, so nothing shows before the poster paints. The shadow and the hover and focus
// glow are in the <style> block below, because inline styles cannot answer :hover.
const clipBoxStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  aspectRatio: '792 / 946',
  borderRadius: '16px',
  overflow: 'hidden',
  background: 'var(--cc-bg)',
};
const clipVideoStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  pointerEvents: 'none',
};

/**
 * A short looping video of the same chat card, shown in place of the DOM mock on desktop. It is
 * decoration: the button around it carries the accessible name. If it cannot load or play, it
 * calls onFail and the section goes back to the DOM mock.
 */
function CardClip({ onFail }: { onFail: () => void }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Play only while the card is on screen and the tab is visible.
  useEffect(() => {
    const box = boxRef.current;
    const video = videoRef.current;
    if (!box || !video) return;

    let onScreen = true; // until the observer says otherwise
    const sync = () => {
      if (!onScreen || document.hidden) {
        video.pause();
        return;
      }
      const started = video.play() as Promise<void> | undefined;
      // AbortError just means a pause() cut a play() short; anything else (autoplay blocked,
      // unsupported media) means the clip will not run, so fall back to the DOM mock.
      started?.catch?.((err: unknown) => {
        if ((err as { name?: string } | null)?.name !== 'AbortError') onFail();
      });
    };

    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(
        (entries) => {
          onScreen = entries[entries.length - 1].isIntersecting;
          sync();
        },
        { threshold: 0.1 }
      );
      observer.observe(box);
    }
    document.addEventListener('visibilitychange', sync);
    sync();

    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [onFail]);

  return (
    <span ref={boxRef} className="aic-clip" aria-hidden="true" style={clipBoxStyle}>
      <video
        ref={videoRef}
        style={clipVideoStyle}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster="/concierge-card-poster.jpg"
        disablePictureInPicture
        aria-hidden="true"
        onError={onFail}
      >
        <source src="/concierge-card-loop.mp4" type="video/mp4" onError={onFail} />
      </video>
    </span>
  );
}

const buttonBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '48px',
  padding: '0 28px',
  borderRadius: '24px',
  fontFamily: "'Outfit', sans-serif",
  fontSize: '14px',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  textDecoration: 'none',
  cursor: 'pointer',
  transition: 'background-color 0.2s ease, border-color 0.2s ease',
};

export default function AiConcierge() {
  // False only in a production build with no Worker URL (see components/concierge/config.ts).
  const enabled = isConciergeEnabled();
  const sectionRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Desktop with motion allowed gets the looping clip; everyone else, and anyone whose browser
  // cannot load or play it, gets the DOM mock (previewContent).
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const [clipFailed, setClipFailed] = useState(false);
  const onClipFail = useCallback(() => setClipFailed(true), []);
  const showClip = isDesktop && !reduceMotion && !clipFailed;

  // Deep link. The page is rendered client-side, so the browser's own jump to
  // #ai-concierge on a fresh load runs before this section exists. Jump once
  // mounted, and again after load if the section is still near the top of the
  // screen (images above can shift the layout).
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || window.location.hash !== '#ai-concierge') return;
    const jump = () => section.scrollIntoView({ block: 'start' });
    const settle = () => {
      if (Math.abs(section.getBoundingClientRect().top) < window.innerHeight) jump();
    };
    jump();
    if (document.readyState !== 'complete') window.addEventListener('load', settle, { once: true });
    return () => window.removeEventListener('load', settle);
  }, []);

  useEffect(() => {
    const copy = copyRef.current;
    const card = cardRef.current;
    if (!copy || !card) return;

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      gsap.set([copy, card], { opacity: 1, y: 0 });
      return;
    }

    const copySt = ScrollTrigger.create({
      trigger: copy,
      start: 'top 85%',
      once: true,
      onEnter: () => {
        gsap.fromTo(
          copy,
          { opacity: 0, y: 24 },
          { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }
        );
      },
    });

    const cardSt = ScrollTrigger.create({
      trigger: card,
      start: 'top 90%',
      once: true,
      onEnter: () => {
        gsap.fromTo(
          card,
          { opacity: 0, y: 28 },
          { opacity: 1, y: 0, duration: 0.7, delay: 0.1, ease: 'power3.out' }
        );
      },
    });

    return () => {
      copySt.kill();
      cardSt.kill();
    };
  }, []);

  const previewContent = (
    <>
      <span className="thg-cc-header">
        <span className="thg-cc-heading">
          <span className="thg-cc-title">{PANEL_TITLE}</span>
          <span className="thg-cc-badge">AI</span>
        </span>
      </span>
      <span className="thg-cc-disclosure">{DISCLOSURE}</span>
      <span className="thg-cc-scroll">
        <span className="thg-cc-list">
          <span className="thg-cc-row thg-cc-row--assistant">
            <span className="thg-cc-msg thg-cc-msg--assistant">{GREETING}</span>
          </span>
          <span className="thg-cc-row thg-cc-row--user">
            <span className="thg-cc-msg thg-cc-msg--user">{PREVIEW_QUESTION}</span>
          </span>
          <span className="thg-cc-row thg-cc-row--assistant">
            <span className="thg-cc-msg thg-cc-msg--assistant">{PREVIEW_ANSWER}</span>
          </span>
        </span>
      </span>
      <span className="thg-cc-chips">
        {OFFER_CHIPS.map((chip) => (
          <span key={chip} className="thg-cc-chip">
            {chip}
          </span>
        ))}
      </span>
      <span className="thg-cc-composer">
        <span className="thg-cc-composer-row">
          <span className="thg-cc-input thg-cc-fake-input">Type your question…</span>
          <span className="thg-cc-send">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5" />
              <path d="m5 12 7-7 7 7" />
            </svg>
          </span>
        </span>
        <span className="thg-cc-meta" />
      </span>
    </>
  );

  return (
    <section
      id="ai-concierge"
      ref={sectionRef}
      style={{
        width: '100%',
        backgroundColor: 'var(--thg-bg-page)',
        padding: 'clamp(80px, 10vw, 140px) clamp(24px, 5vw, 80px)',
        borderTop: '1px solid var(--thg-bg-section-border)',
        transition: 'background-color 0.3s ease',
      }}
    >
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        <div className="aic-grid">
          <div ref={copyRef} style={{ opacity: 0, minWidth: 0 }}>
            <span
              className="font-mono-label"
              style={{
                color: 'var(--thg-text-tertiary)',
                display: 'block',
                marginBottom: '20px',
              }}
            >
              AI Website Concierge
            </span>
            <h2
              className="font-heading-xl"
              style={{
                color: 'var(--thg-text-primary)',
                maxWidth: '820px',
                margin: 0,
              }}
            >
              An AI helper that answers your website 24/7
            </h2>
            <p
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontSize: '17px',
                lineHeight: 1.6,
                color: 'var(--thg-text-secondary)',
                maxWidth: '700px',
                margin: '20px 0 0',
              }}
            >
              Your customers have questions at 9 PM and on Sundays. Our AI Website Concierge is a
              friendly chat helper on your website that answers common questions, takes down their
              name and number, and sets up a callback — so you don't lose the job and you don't
              have to be glued to your phone. More time for your family, fewer missed leads.
            </p>

            <ul
              style={{
                listStyle: 'none',
                margin: '28px 0 0',
                padding: 0,
                display: 'grid',
                gap: '12px',
              }}
            >
              {bullets.map((text) => (
                <li
                  key={text}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    fontFamily: "'Outfit', sans-serif",
                    fontSize: '16px',
                    lineHeight: 1.5,
                    color: 'var(--thg-text-primary)',
                  }}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#2563EB"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ flex: 'none', marginTop: '2px' }}
                  >
                    <circle cx="12" cy="12" r="9.5" />
                    <path d="m8 12.5 2.8 2.8L16.2 9.6" />
                  </svg>
                  <span>{text}</span>
                </li>
              ))}
            </ul>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px 16px',
                marginTop: '36px',
              }}
            >
              {enabled && (
                <button
                  type="button"
                  data-cta-id="concierge_try"
                  data-cta-label="Try it now"
                  onClick={openTryChat}
                  style={{
                    ...buttonBase,
                    border: 'none',
                    backgroundColor: '#2563EB',
                    color: '#FFFFFF',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#1E40AF';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#2563EB';
                  }}
                >
                  Try it now
                </button>
              )}
              <a
                href={PHONE_HREF}
                onClick={() => track('concierge_call_click', { location: 'section' })}
                style={{
                  ...buttonBase,
                  border: '1px solid var(--thg-border-medium)',
                  backgroundColor: 'transparent',
                  color: 'var(--thg-text-primary)',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--thg-border-strong)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--thg-border-medium)';
                }}
              >
                Call {PHONE_DISPLAY}
              </a>
            </div>

            <p
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontSize: '14px',
                lineHeight: 1.5,
                color: 'var(--thg-text-secondary)',
                margin: '20px 0 0',
                maxWidth: '560px',
              }}
            >
              Proudly based in Woodstock, GA, helping local businesses across Cherokee County and
              metro Atlanta.
            </p>
          </div>

          {/* Preview of the real widget. On desktop it is a looping clip of the card; otherwise
              (phones are hidden by CSS, reduced motion, clip fails) a DOM mock built from the same
              .thg-cc-* styles. When the chat is live it is one big button that opens it; otherwise
              it is decoration. Everything inside is a span (or the muted video) and hidden from
              assistive tech, so a screen reader gets a single, clearly named control. */}
          <div ref={cardRef} className="aic-card-wrap" style={{ opacity: 0, minWidth: 0 }} aria-hidden={enabled ? undefined : 'true'}>
            {enabled ? (
              <button
                type="button"
                className="thg-cc-card-button aic-card"
                aria-label="Try the AI Website Concierge"
                onClick={openTryChat}
              >
                {showClip ? (
                  <CardClip onFail={onClipFail} />
                ) : (
                  <span className="thg-cc-card thg-cc-surface" aria-hidden="true">
                    {previewContent}
                  </span>
                )}
                <span className="thg-cc-card-pill" aria-hidden="true">
                  Click to try it
                </span>
              </button>
            ) : (
              <div className="thg-cc-card thg-cc-surface aic-card">{previewContent}</div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .aic-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 48px;
          align-items: center;
        }
        .aic-card { margin: 0; }
        /* The looping clip gets the card's shadow and the same glow on hover and focus. (No
           percent signs in this block: the section's tests read its text for stray statistics.) */
        .aic-clip {
          box-shadow: var(--cc-shadow);
          transition: box-shadow 0.2s ease;
        }
        @media (hover: hover) {
          .thg-cc-card-button:hover .aic-clip {
            box-shadow: 0 0 0 1px var(--cc-brand), 0 0 32px rgba(37, 99, 235, 0.35), var(--cc-shadow);
          }
        }
        .thg-cc-card-button:focus-visible .aic-clip {
          box-shadow: 0 0 0 1px var(--cc-brand), 0 0 32px rgba(37, 99, 235, 0.35), var(--cc-shadow);
        }
        /* Phones get the copy and the buttons only; the preview card is desktop-only. */
        @media (max-width: 899px) {
          .aic-card-wrap { display: none; }
        }
        @media (min-width: 900px) {
          .aic-grid {
            grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
            gap: 64px;
          }
          .aic-card { margin-left: auto; }
        }
      `}</style>
    </section>
  );
}
