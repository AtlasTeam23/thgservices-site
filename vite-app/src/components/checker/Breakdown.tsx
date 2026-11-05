import { Copy, Check, LifeBuoy, RotateCcw } from 'lucide-react';
import * as copy from '../../lib/checker/copy';
import { renderSanitizedDetail } from '../../lib/checker/sanitize';
import type { Report, ReportCheck, ReportCompetitor } from '../../lib/checker/types';
import GradeGauge, { GradePill } from './GradeGauge';
import { asStatus } from '../../lib/checker/grades';
import StatusChip, { StatusIcon } from './StatusChip';

type Props = {
  report: Report;
  /** Shown under the heading, for example "We emailed a copy to you@example.com." */
  notice?: string | null;
  /** Extra content between the notice and the plan (the optional email-me field). */
  children?: React.ReactNode;
  copyState: 'idle' | 'copied' | 'failed';
  /** The report link, shown for selecting when copying fails. */
  link: string | null;
  onHelp: () => void;
  onCopyLink: () => void;
  onRecheck: () => void;
};

const arr = <T,>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : []);

function checkTitles(report: Report): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of arr(report.sections))
    for (const c of arr(s.categories)) for (const k of arr(c.checks)) map.set(k.id, k.title);
  for (const f of arr(report.top_fixes)) if (!map.has(f.check_id)) map.set(f.check_id, f.title);
  return map;
}

function CheckRow({ check }: { check: ReportCheck }) {
  const status = asStatus(check.status);
  return (
    <li className={`ck-check ck-check--${status}`}>
      <div className="ck-check__head">
        <StatusChip status={status} />
        <h5 className="ck-check__title">{check.title}</h5>
      </div>
      {check.finding ? <p className="ck-check__finding">{renderSanitizedDetail(check.finding)}</p> : null}
      {check.fix && status !== 'pass' ? (
        <p className="ck-check__fix">
          <b>Fix:</b> {renderSanitizedDetail(check.fix)}
        </p>
      ) : null}
    </li>
  );
}

function ComparisonTable({ report, competitors }: { report: Report; competitors: ReportCompetitor[] }) {
  const rows: { id: string; title: string; status: ReturnType<typeof asStatus> }[] = [];
  for (const s of arr(report.sections))
    for (const c of arr(s.categories))
      for (const k of arr(c.checks)) rows.push({ id: k.id, title: k.title, status: asStatus(k.status) });
  const lookups = competitors.map((c) => new Map(arr(c.checks).map((k) => [k.id, asStatus(k.status)])));
  const gapRows = rows.filter(
    (r) => r.status !== 'pass' && lookups.some((m) => m.get(r.id) === 'pass')
  ).length;

  return (
    <section className="ck-card" aria-labelledby="ck-compare-h">
      <h3 id="ck-compare-h" className="ck-h3">
        {copy.COMPARISON_HEADING}
      </h3>
      <table className="ck-table ck-table--grades">
        <thead>
          <tr>
            <th scope="col">Site</th>
            <th scope="col">Overall</th>
            <th scope="col">SEO</th>
            <th scope="col">Conversion</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">{copy.YOUR_SITE}</th>
            <td><GradePill grade={report.overall} label="Overall" /></td>
            <td><GradePill grade={report.seo} label="SEO" /></td>
            <td><GradePill grade={report.conversion} label="Conversion" /></td>
          </tr>
          {competitors.map((c, i) => (
            <tr key={`${c.host}-${i}`}>
              <th scope="row">
                <span className="ck-host">{c.host}</span>
              </th>
              <td><GradePill grade={c.overall} label="Overall" /></td>
              <td><GradePill grade={c.seo} label="SEO" /></td>
              <td><GradePill grade={c.conversion} label="Conversion" /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="ck-muted">{copy.COMPARISON_GAP_NOTE}</p>
      <p className="ck-muted" data-testid="gap-count">
        {gapRows === 1 ? '1 check where a competitor does better.' : `${gapRows} checks where a competitor does better.`}
      </p>
      <ul className="ck-legend" aria-label="Competitor columns">
        {competitors.map((c, i) => (
          <li key={`${c.host}-${i}`}>
            <b>{i + 1}</b> {c.host}
          </li>
        ))}
      </ul>
      <table className="ck-table ck-table--checks">
        <thead>
          <tr>
            <th scope="col">Check</th>
            <th scope="col" className="ck-col">You</th>
            {competitors.map((c, i) => (
              <th key={`${c.host}-${i}`} scope="col" className="ck-col" title={c.host}>
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const passing = lookups.filter((m) => m.get(r.id) === 'pass').length;
            const gap = r.status !== 'pass' && passing > 0;
            return (
              <tr key={r.id} className={gap ? 'ck-gap' : undefined} data-gap={gap ? 'true' : 'false'}>
                <th scope="row">
                  {r.title}
                  {gap && (
                    <span className="ck-gap__note">
                      {passing} of {competitors.length} {competitors.length === 1 ? 'competitor passes' : 'competitors pass'}
                    </span>
                  )}
                </th>
                <td className="ck-col">
                  <span role="img" className={`ck-mark ck-mark--${r.status}`} aria-label={copy.STATUS_LABEL[r.status]}>
                    <StatusIcon status={r.status} />
                  </span>
                </td>
                {lookups.map((m, i) => {
                  const st = m.get(r.id);
                  return (
                    <td key={i} className="ck-col">
                      {st ? (
                        <span role="img" className={`ck-mark ck-mark--${st}`} aria-label={copy.STATUS_LABEL[st]}>
                          <StatusIcon status={st} />
                        </span>
                      ) : (
                        <span role="img" className="ck-muted" aria-label="Not compared">-</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export default function Breakdown({ report, notice, children, copyState, link, onHelp, onCopyLink, onRecheck }: Props) {
  const titles = checkTitles(report);
  const plan = report.plan && (arr(report.plan.items).length > 0 || report.plan.summary) ? report.plan : null;
  const competitors = arr(report.competitors);
  const topFixes = arr(report.top_fixes);

  return (
    <div className="ck-breakdown" data-testid="breakdown">
      <header className="ck-breakdown__head">
        <h2 className="ck-h2" tabIndex={-1} data-focus-target>
          {copy.REPORT_FOR(report.host)}
        </h2>
        {notice ? <p className="ck-notice" role="status">{notice}</p> : null}
      </header>

      <div className="ck-gauges ck-gauges--compact">
        {report.overall ? <GradeGauge label={copy.OVERALL_LABEL} grade={report.overall} size={96} /> : null}
        <GradeGauge label={copy.SEO_LABEL} grade={report.seo} size={96} />
        {report.conversion ? <GradeGauge label={copy.CONVERSION_LABEL} grade={report.conversion} size={96} /> : null}
      </div>
      {report.read_limited ? <p className="ck-banner" role="note">{copy.READ_LIMITED_BANNER}</p> : null}

      {children}

      {plan ? (
        <section className="ck-card" aria-labelledby="ck-plan-h">
          <h3 id="ck-plan-h" className="ck-h3">{copy.PLAN_HEADING}</h3>
          {plan.summary ? <p className="ck-plan__summary">{plan.summary}</p> : null}
          <ol className="ck-plan">
            {arr(plan.items).map((item, i) => (
              <li key={`${item.check_id}-${i}`}>
                {titles.get(item.check_id) ? <b>{titles.get(item.check_id)}</b> : null}
                <p>{item.text}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {topFixes.length > 0 ? (
        <section className="ck-card" aria-labelledby="ck-fix-h">
          <h3 id="ck-fix-h" className="ck-h3">{copy.FIX_FIRST_HEADING}</h3>
          <ol className="ck-fixes">
            {topFixes.map((f, i) => (
              <li key={`${f.check_id}-${i}`}>
                <b>{f.title}</b>
                <p>{renderSanitizedDetail(f.fix)}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {arr(report.sections).map((section) => (
        <section key={section.id} className="ck-card" aria-labelledby={`ck-sec-${section.id}`}>
          <h3 id={`ck-sec-${section.id}`} className="ck-h3">{section.title}</h3>
          {section.subtitle ? <p className="ck-muted">{section.subtitle}</p> : null}
          {arr(section.categories).map((cat) => (
            <div key={cat.id} className="ck-cat">
              <h4 className="ck-h4">{cat.label}</h4>
              <ul className="ck-checks">
                {arr(cat.checks).map((check) => (
                  <CheckRow key={check.id} check={check} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}

      {competitors.length > 0 ? <ComparisonTable report={report} competitors={competitors} /> : null}

      <div className="ck-actions">
        <button type="button" className="ck-btn ck-btn--primary" onClick={onHelp}>
          <LifeBuoy size={18} aria-hidden="true" />
          {copy.GET_HELP}
        </button>
        <button type="button" className="ck-btn" onClick={onCopyLink}>
          {copyState === 'copied' ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
          {copyState === 'copied' ? copy.LINK_COPIED : copy.COPY_LINK}
        </button>
        <button type="button" className="ck-btn" onClick={onRecheck}>
          <RotateCcw size={18} aria-hidden="true" />
          {copy.CHECK_AGAIN}
        </button>
      </div>
      {copyState === 'failed' && link ? (
        <div role="alert" className="ck-copyfail">
          <p className="ck-error">{copy.COPY_FAILED}</p>
          <input type="text" readOnly value={link} aria-label="Report link" onFocus={(e) => e.currentTarget.select()} />
        </div>
      ) : null}
      <p className="ck-muted ck-footnote">{copy.BREAKDOWN_FOOTER}</p>
    </div>
  );
}
