import { safeLetter } from '../../lib/checker/grades';
import type { Grade } from '../../lib/checker/types';

type Props = {
  label: string;
  sub?: string;
  grade: Grade | null;
  size?: number;
  /** Render the Overall gauge a little larger and give it a heading level. */
  featured?: boolean;
};

/**
 * A ring gauge in the spirit of LeadQuik's audit gauge, written for this site.
 * The ring and letter take their color from theme-aware CSS tokens
 * (--ck-grade-a to --ck-grade-f, see checker.css), so the lime and amber grades
 * stay readable on the light theme.
 */
export default function GradeGauge({ label, sub, grade, size = 132, featured = false }: Props) {
  const letter = safeLetter(grade?.grade);
  const score = grade && Number.isFinite(grade.score) ? Math.max(0, Math.min(100, grade.score)) : null;
  const stroke = Math.max(8, Math.round(size * 0.085));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = score === null ? 0 : (score / 100) * circumference;
  const color = letter ? `var(--ck-grade-${letter.toLowerCase()})` : 'var(--thg-text-quaternary)';
  const aria =
    letter && score !== null ? `${label} grade ${letter}, ${score} out of 100` : `${label} not graded`;

  return (
    <div className={`ck-gauge${featured ? ' ck-gauge--featured' : ''}`} data-testid={`gauge-${label.toLowerCase()}`}>
      <div className="ck-gauge__ring" style={{ width: size, height: size }} role="img" aria-label={aria}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--thg-border-subtle)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div className="ck-gauge__center" aria-hidden="true">
          <span className="ck-gauge__letter" style={{ color, fontSize: size * 0.4 }}>
            {letter ?? '-'}
          </span>
          {score !== null && <span className="ck-gauge__score">{score}/100</span>}
        </div>
      </div>
      <div className="ck-gauge__label">{label}</div>
      {sub && <div className="ck-gauge__sub">{sub}</div>}
    </div>
  );
}

/** A small letter pill for tables. */
export function GradePill({ grade, label }: { grade: Grade | null; label: string }) {
  const letter = safeLetter(grade?.grade);
  if (!letter) {
    return (
      <span role="img" className="ck-pill ck-pill--none" aria-label={`${label} not graded`}>
        -
      </span>
    );
  }
  return (
    <span
      role="img"
      className="ck-pill"
      style={{ color: `var(--ck-grade-${letter.toLowerCase()})` }}
      aria-label={`${label} grade ${letter}`}
    >
      {letter}
    </span>
  );
}
