import { useId } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import * as copy from '../../lib/checker/copy';
import { MAX_COMPETITORS } from '../../lib/checker/config';
import type { ScanOk } from '../../lib/checker/types';
import { GradePill } from './GradeGauge';

export type CompetitorRow = {
  key: number;
  input: string;
  status: 'idle' | 'loading' | 'done' | 'failed';
  scan?: ScanOk;
  message?: string;
};

type Props = {
  yours: ScanOk;
  rows: CompetitorRow[];
  onInput: (key: number, value: string) => void;
  onAdd: () => void;
  onRemove: (key: number) => void;
  onCompare: () => void;
};

export default function CompetitorPanel({ yours, rows, onInput, onAdd, onRemove, onCompare }: Props) {
  const id = useId();
  const busy = rows.some((r) => r.status === 'loading');
  const done = rows.filter((r) => r.status === 'done' && r.scan);
  const canCompare = !busy && rows.some((r) => r.status !== 'done' && r.input.trim() !== '');

  return (
    <section className="ck-card" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="ck-h3">
        {copy.COMPARE_HEADING}
      </h3>
      <p className="ck-muted">{copy.COMPARE_TEXT}</p>

      <div className="ck-comp-rows">
        {rows.map((r, i) => (
          <div key={r.key} className="ck-field ck-comp-row">
            <label htmlFor={`${id}-c${r.key}`}>{copy.COMPETITOR_LABEL(i + 1)}</label>
            <div className="ck-comp-row__line">
              <input
                id={`${id}-c${r.key}`}
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="competitor.com"
                value={r.input}
                disabled={r.status === 'loading' || r.status === 'done'}
                onChange={(e) => onInput(r.key, e.target.value)}
                aria-invalid={r.status === 'failed' ? true : undefined}
                aria-describedby={r.message ? `${id}-m${r.key}` : undefined}
              />
              {r.status === 'loading' ? (
                <Loader2 size={20} className="ck-spin" aria-label="Checking" />
              ) : (
                <button
                  type="button"
                  className="ck-icon-btn"
                  onClick={() => onRemove(r.key)}
                  aria-label={copy.REMOVE_COMPETITOR(i + 1)}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              )}
            </div>
            {r.message ? (
              <p id={`${id}-m${r.key}`} className="ck-error" role="alert">
                {r.message}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="ck-actions">
        {rows.length < MAX_COMPETITORS ? (
          <button type="button" className="ck-btn ck-btn--small" onClick={onAdd} disabled={busy}>
            <Plus size={16} aria-hidden="true" />
            {copy.ADD_COMPETITOR}
          </button>
        ) : null}
        <button type="button" className="ck-btn ck-btn--primary ck-btn--small" onClick={onCompare} disabled={!canCompare}>
          {copy.COMPARE_BUTTON}
        </button>
      </div>

      {done.length > 0 ? (
        <table className="ck-table ck-table--grades" data-testid="competitor-grades">
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
              <td><GradePill grade={yours.overall} label="Overall" /></td>
              <td><GradePill grade={yours.seo} label="SEO" /></td>
              <td><GradePill grade={yours.conversion} label="Conversion" /></td>
            </tr>
            {done.map((r) => (
              <tr key={r.key}>
                <th scope="row">
                  <span className="ck-host">{r.scan!.host}</span>
                </th>
                <td><GradePill grade={r.scan!.overall} label="Overall" /></td>
                <td><GradePill grade={r.scan!.seo} label="SEO" /></td>
                <td><GradePill grade={r.scan!.conversion} label="Conversion" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
