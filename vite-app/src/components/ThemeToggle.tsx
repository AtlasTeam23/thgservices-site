import { useTheme } from '../lib/theme';

type Props = {
  size?: number;
};

/**
 * Small sun/moon icon button for toggling light/dark theme.
 * Uses CSS variables so it adapts naturally to the active theme.
 */
export default function ThemeToggle({ size = 36 }: Props) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '999px',
        background: 'transparent',
        border: '1px solid var(--thg-border-medium)',
        color: 'var(--thg-text-primary)',
        cursor: 'pointer',
        padding: 0,
        transition: 'border-color 0.2s ease, background-color 0.2s ease, color 0.2s ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--thg-border-strong)';
        (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--thg-bg-elevated-strong)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--thg-border-medium)';
        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
      }}
    >
      {isDark ? (
        /* Sun icon → currently dark, clicking switches to light */
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m4.93 19.07 1.41-1.41" />
          <path d="m17.66 6.34 1.41-1.41" />
        </svg>
      ) : (
        /* Moon icon → currently light, clicking switches to dark */
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      )}
    </button>
  );
}
