import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import ThemeToggle from '../components/ThemeToggle';
import Breakdown from '../components/checker/Breakdown';
import CompetitorPanel from '../components/checker/CompetitorPanel';
import GradesView from '../components/checker/GradesView';
import StartForm from '../components/checker/StartForm';
import UnlockForm from '../components/checker/UnlockForm';
import { useReportMeta } from '../components/checker/useReportMeta';
import '../components/checker/checker.css';
import * as copy from '../lib/checker/copy';
import { useCheckerFlow } from './checker/useCheckerFlow';

const TITLE = 'Free Website Checker | THG AI Services';
const TOKEN_RE = /^[A-Za-z0-9_-]{16,200}$/;

function OptionalEmailCopy({ onSend }: { onSend: (email: string) => Promise<boolean> }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'failed'>('idle');
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  return (
    <form
      className="ck-card ck-inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setState('sending');
        const ok = await onSend(email.trim());
        setState(ok ? 'idle' : 'failed');
      }}
    >
      <label htmlFor="ck-copy-email">{copy.OPTIONAL_EMAIL_LABEL}</label>
      <div className="ck-comp-row__line">
        <input
          id="ck-copy-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className="ck-btn ck-btn--small" disabled={!valid || state === 'sending'}>
          {copy.OPTIONAL_EMAIL_BUTTON}
        </button>
      </div>
      {state === 'failed' ? (
        <p className="ck-error" role="alert">
          {copy.EMAIL_NOT_SENT}
        </p>
      ) : null}
    </form>
  );
}

/** Remounts the screen when the report token changes, so its state starts clean. */
export default function WebsiteChecker() {
  const [params] = useSearchParams();
  const rawToken = (params.get('r') ?? '').trim();
  return <CheckerScreen key={rawToken} rawToken={rawToken} />;
}

function CheckerScreen({ rawToken }: { rawToken: string }) {
  const [, setParams] = useSearchParams();
  const token = TOKEN_RE.test(rawToken) ? rawToken : null;
  const badToken = rawToken !== '' && token === null;
  const mainRef = useRef<HTMLElement>(null);

  const clearToken = useCallback(() => {
    setParams(
      (prev) => {
        if (!prev.has('r')) return prev;
        const next = new URLSearchParams(prev);
        next.delete('r');
        return next;
      },
      { replace: true }
    );
  }, [setParams]);

  useReportMeta(rawToken !== '');

  useEffect(() => {
    const before = document.title;
    document.title = TITLE;
    return () => {
      document.title = before;
    };
  }, []);

  const flow = useCheckerFlow(token, clearToken);
  const view = badToken && flow.view === 'start' ? 'reportMissing' : flow.view;

  // Move focus to the new screen's heading so keyboard and screen reader users land on it.
  useEffect(() => {
    mainRef.current?.querySelector<HTMLElement>('[data-focus-target]')?.focus({ preventScroll: false });
  }, [view]);

  const { scan } = flow;

  return (
    <div className="ck-page">
      <header className="ck-header">
        <BrandLogo size={56} href="/" />
        <ThemeToggle size={40} />
      </header>

      <main ref={mainRef} className="ck-main">
        <h1 className="ck-h1">{copy.START_HEADING}</h1>

        {view === 'start' && (
          <>
            <p className="ck-sub">{copy.START_SUB}</p>
            <StartForm initial={flow.values} error={flow.startError} onSubmit={flow.submitStart} />
          </>
        )}

        {view === 'checking' && (
          <div className="ck-card ck-checking" role="status">
            <Loader2 size={36} className="ck-spin" aria-hidden="true" />
            <p>{copy.CHECKING_TEXT}</p>
          </div>
        )}

        {view === 'loadingReport' && (
          <div className="ck-card ck-checking" role="status">
            <Loader2 size={36} className="ck-spin" aria-hidden="true" />
            <p>{copy.LOADING_REPORT}</p>
          </div>
        )}

        {view === 'failed' && flow.failure && (
          <div className="ck-card" role="alert">
            <p className="ck-failure" tabIndex={-1} data-focus-target>
              {flow.failure.text}
            </p>
            <div className="ck-actions">
              {flow.failure.reason === 'blocked' && (
                <button type="button" className="ck-btn ck-btn--primary" onClick={() => flow.help('blocked')}>
                  {copy.ASK_A_PERSON}
                </button>
              )}
              <button type="button" className="ck-btn" onClick={flow.backToStart}>
                {copy.TRY_ANOTHER}
              </button>
            </div>
          </div>
        )}

        {view === 'reportMissing' && (
          <div className="ck-card" role="alert">
            <p className="ck-failure" tabIndex={-1} data-focus-target>
              {copy.REPORT_NOT_FOUND}
            </p>
            <div className="ck-actions">
              <button
                type="button"
                className="ck-btn ck-btn--primary"
                onClick={() => {
                  clearToken();
                  flow.backToStart();
                }}
              >
                {copy.CHECK_A_SITE}
              </button>
            </div>
          </div>
        )}

        {view === 'grades' && scan && (
          <>
            <GradesView scan={scan} busy={flow.busy} recheckMessage={flow.recheckMessage} onRecheck={flow.recheck} />
            <CompetitorPanel
              yours={scan}
              rows={flow.rows}
              onInput={flow.setRowInput}
              onAdd={flow.addRow}
              onRemove={flow.removeRow}
              onCompare={flow.compare}
            />
            <UnlockForm
              gated={scan.gated}
              busy={flow.busy}
              serverFields={flow.serverFields}
              error={flow.unlockError}
              onSubmit={flow.unlock}
            />
          </>
        )}

        {view === 'breakdown' && flow.report && (
          <Breakdown
            report={flow.report}
            notice={
              flow.emailedTo ? copy.EMAILED_TO(flow.emailedTo) : flow.emailFailed ? copy.EMAIL_NOT_SENT : null
            }
            linkCopied={flow.linkCopied}
            onHelp={() => flow.help('breakdown')}
            onCopyLink={flow.copyLink}
            onRecheck={flow.checkAnother}
          >
            {scan && !scan.gated && !flow.emailedTo && !token ? (
              <OptionalEmailCopy onSend={flow.emailCopy} />
            ) : null}
          </Breakdown>
        )}
      </main>

      <footer className="ck-footer">
        <span>&copy; {new Date().getFullYear()} THG Services, LLC</span>
        <span>
          <a href="/">Home</a>
          <a href="/privacy.html">Privacy</a>
          <a href="/terms.html">Terms</a>
        </span>
      </footer>
    </div>
  );
}
