import { RotateCcw } from 'lucide-react';
import * as copy from '../../lib/checker/copy';
import { timeAgo } from '../../lib/checker/format';
import type { ScanOk } from '../../lib/checker/types';
import GradeGauge from './GradeGauge';

type Props = {
  scan: ScanOk;
  busy: boolean;
  recheckMessage: string | null;
  onRecheck: () => void;
};

export default function GradesView({ scan, busy, recheckMessage, onRecheck }: Props) {
  const sections = [
    { id: 'seo', title: copy.SEO_LABEL },
    { id: 'conversion', title: copy.CONVERSION_LABEL },
  ].map((s) => ({ ...s, cats: (scan.summary.categories ?? []).filter((c) => c.section === s.id) }));

  return (
    <section className="ck-card ck-grades" aria-labelledby="ck-grades-h">
      <h2 id="ck-grades-h" className="ck-h2" tabIndex={-1} data-focus-target>
        {scan.host}
      </h2>

      {scan.overall ? (
        <div className="ck-gauges ck-gauges--overall">
          <GradeGauge label={copy.OVERALL_LABEL} grade={scan.overall} size={160} featured />
        </div>
      ) : null}

      <div className="ck-gauges">
        <GradeGauge label={copy.SEO_LABEL} sub={copy.SEO_SUB} grade={scan.seo} />
        {scan.conversion ? (
          <GradeGauge label={copy.CONVERSION_LABEL} sub={copy.CONVERSION_SUB} grade={scan.conversion} />
        ) : null}
      </div>

      {scan.read_limited ? (
        <p className="ck-banner" role="note">
          {copy.READ_LIMITED_BANNER}
        </p>
      ) : null}

      <p className="ck-counts">
        {copy.COUNTS_LINE(scan.summary.to_fix, scan.summary.to_improve, scan.summary.passing)}
      </p>

      {sections.map((s) =>
        s.cats.length > 0 ? (
          <div key={s.id} className="ck-cats">
            <h3 className="ck-h4">{s.title}</h3>
            <ul>
              {s.cats.map((c) => (
                <li key={c.id}>
                  <span className="ck-cats__label">{c.label}</span>
                  <span className="ck-cats__counts">
                    {c.to_fix} to fix, {c.to_improve} to improve, {c.passing} passing
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null
      )}

      {scan.cached ? (
        <div className="ck-cached">
          <span>{copy.CHECKED_AGO(timeAgo(scan.checked_at))}</span>
          <button type="button" className="ck-btn ck-btn--small" onClick={onRecheck} disabled={busy}>
            <RotateCcw size={16} aria-hidden="true" />
            {copy.CHECK_AGAIN}
          </button>
        </div>
      ) : null}
      {recheckMessage ? (
        <p className="ck-error" role="alert">
          {recheckMessage}
        </p>
      ) : null}
    </section>
  );
}
