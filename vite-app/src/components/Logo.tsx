import { useId } from 'react';

type LogoProps = {
  /** Pixel size of the orb (square). Default 32. */
  size?: number;
  /** Show "THG Services" wordmark next to the orb. Default true. */
  showWordmark?: boolean;
  /** Color of the wordmark text. Defaults to the active theme's primary text color. */
  wordmarkColor?: string;
  /** Override default font weight on the wordmark. */
  wordmarkWeight?: number;
  /** Optional className on the wrapping anchor / span. */
  className?: string;
  /** If passed, wraps the logo in an `<a href>`. */
  href?: string;
  /** onClick handler if href provided. */
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
};

/**
 * THG Services logo — glossy 3D orb with the same blue→teal gradient palette
 * used by LeadQuik, paired with an Outfit wordmark.
 *
 * The orb is unique-ID'd per instance so multiple logos on one page don't
 * collide on their gradient definitions.
 */
export default function Logo({
  size = 32,
  showWordmark = true,
  wordmarkColor = 'var(--thg-text-primary)',
  wordmarkWeight = 700,
  className,
  href,
  onClick,
}: LogoProps) {
  const id = useId().replace(/:/g, '-');
  const orbCore = `orb-core-${id}`;
  const orbSheen = `orb-sheen-${id}`;
  const orbGlow = `orb-glow-${id}`;
  const orbInner = `orb-inner-${id}`;

  const inner = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: showWordmark ? Math.round(size * 0.32) : 0,
        textDecoration: 'none',
      }}
    >
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        aria-hidden="true"
        style={{
          flexShrink: 0,
          overflow: 'visible',
          display: 'block',
        }}
      >
        <defs>
          {/* Main orb core: cyan center → primary blue → deep blue → teal edge */}
          <radialGradient id={orbCore} cx="38%" cy="34%" r="68%">
            <stop offset="0%" stopColor="hsl(180 95% 80%)" stopOpacity="1" />
            <stop offset="38%" stopColor="hsl(221 83% 53%)" stopOpacity="1" />
            <stop offset="78%" stopColor="hsl(220 80% 38%)" stopOpacity="1" />
            <stop offset="100%" stopColor="hsl(160 60% 28%)" stopOpacity="0.95" />
          </radialGradient>

          {/* Bright sheen highlight upper-left */}
          <radialGradient id={orbSheen} cx="30%" cy="24%" r="34%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
            <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>

          {/* Soft outer glow halo */}
          <radialGradient id={orbGlow} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(221 83% 53%)" stopOpacity="0.5" />
            <stop offset="55%" stopColor="hsl(180 80% 55%)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="hsl(221 83% 53%)" stopOpacity="0" />
          </radialGradient>

          {/* Subtle inner shadow rim for depth */}
          <radialGradient id={orbInner} cx="50%" cy="60%" r="60%">
            <stop offset="60%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.35)" />
          </radialGradient>
        </defs>

        {/* Outer glow halo (slightly larger than the orb) */}
        <circle cx="32" cy="32" r="30" fill={`url(#${orbGlow})`} />

        {/* Main orb */}
        <circle cx="32" cy="32" r="22" fill={`url(#${orbCore})`} />

        {/* Inner rim depth */}
        <circle cx="32" cy="32" r="22" fill={`url(#${orbInner})`} />

        {/* Sheen highlight */}
        <ellipse cx="25" cy="22" rx="11" ry="8" fill={`url(#${orbSheen})`} />

        {/* Hairline edge ring */}
        <circle
          cx="32"
          cy="32"
          r="22"
          fill="none"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="0.6"
        />
      </svg>

      {showWordmark && (
        <span
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: Math.max(13, Math.round(size * 0.5)),
            fontWeight: wordmarkWeight,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: wordmarkColor,
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}
        >
          THG Services
        </span>
      )}
    </span>
  );

  if (href) {
    return (
      <a
        href={href}
        onClick={onClick}
        className={className}
        style={{ textDecoration: 'none', display: 'inline-flex' }}
      >
        {inner}
      </a>
    );
  }

  return (
    <span className={className} style={{ display: 'inline-flex' }}>
      {inner}
    </span>
  );
}
