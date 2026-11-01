const APP_STORE_BADGE_SRC = '/app-store-badge.svg';

type AppStoreBadgeProps = {
  href: string;
  height?: number;
};

/**
 * Official "Download on the App Store" badge (US/UK black artwork from
 * Apple's marketing guidelines). Display height stays at or above Apple's
 * 40px on-screen minimum.
 */
export default function AppStoreBadge({
  href,
  height = 40,
}: AppStoreBadgeProps) {
  const width = Math.round(height * (119.66407 / 40));

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      style={{
        display: 'inline-block',
        lineHeight: 0,
        /* Apple: clear space ≈ 1/4 of badge height */
        padding: `${Math.round(height / 4)}px`,
      }}
    >
      <img
        src={APP_STORE_BADGE_SRC}
        alt="Download on the App Store"
        width={width}
        height={height}
        style={{ display: 'block', height, width }}
      />
    </a>
  );
}
