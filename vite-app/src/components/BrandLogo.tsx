import { useTheme } from '../lib/theme';

type BrandLogoProps = {
  /** Height in pixels. The logo scales proportionally (it's square source). */
  size?: number;
  /** Optional className on the wrapping anchor / span. */
  className?: string;
  /** If passed, wraps the logo in an `<a href>`. */
  href?: string;
  /** onClick handler if href provided. */
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  /** Accessible name. Defaults to "THG AI Services". */
  alt?: string;
  /**
   * Which image variant to serve:
   * - 'auto' (default) picks by active theme (dark-bg for dark, dark-letters for light)
   * - 'dark-bg' always serves the version with the navy backdrop + light letters
   * - 'transparent' serves the transparent-background version with original
   *   light letters (useful for surfaces that are a fixed dark color regardless
   *   of the global theme — e.g. the footer).
   * - 'dark-letters' serves the transparent-background version with inverted dark
   *   letters (readable on light surfaces).
   */
  variant?: 'auto' | 'dark-bg' | 'transparent' | 'dark-letters';
};

/**
 * BrandLogo
 *
 * The THG AI Services wordmark image. Picks the dark-background PNG in
 * dark theme and the transparent PNG in light theme (so the logo's
 * subtle navy backdrop doesn't paint a dark rectangle on the warm
 * off-white page bg).
 *
 * This replaces the procedural `Logo` component for the primary brand
 * mark. `Logo.tsx` is still available for small-space uses (e.g. favicon
 * fallbacks) but the display brand across nav + footer is now this.
 */
export default function BrandLogo({
  size = 56,
  className,
  href,
  onClick,
  alt = 'THG AI Services',
  variant = 'auto',
}: BrandLogoProps) {
  const { theme } = useTheme();
  // Resolve which concrete asset to serve.
  // 'auto' => dark-bg in dark theme, dark-letters in light theme (readable)
  // 'dark-bg' => always the navy-backdrop version
  // 'transparent' => original light-letter transparent (for dark surfaces)
  // 'dark-letters' => inverted dark-letter transparent (for light surfaces)
  let src: string;
  if (variant === 'dark-bg') {
    src = '/thg-ai-services-logo.png';
  } else if (variant === 'transparent') {
    src = '/thg-ai-services-logo-transparent.png';
  } else if (variant === 'dark-letters') {
    src = '/thg-ai-services-logo-dark-letters.png';
  } else {
    // auto
    src =
      theme === 'dark'
        ? '/thg-ai-services-logo.png'
        : '/thg-ai-services-logo-dark-letters.png';
  }

  const img = (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      style={{
        display: 'block',
        height: `${size}px`,
        width: `${size}px`,
        objectFit: 'contain',
      }}
    />
  );

  if (href) {
    return (
      <a
        href={href}
        onClick={onClick}
        className={className}
        aria-label={alt}
        style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
      >
        {img}
      </a>
    );
  }

  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center' }}>
      {img}
    </span>
  );
}
