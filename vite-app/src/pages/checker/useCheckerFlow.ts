import { useCallback, useEffect, useRef, useState } from 'react';
import { openConcierge } from '../../components/concierge/events';
import type { CompetitorRow } from '../../components/checker/CompetitorPanel';
import type { StartValues } from '../../components/checker/StartForm';
import type { UnlockValues } from '../../components/checker/UnlockForm';
import { trackEvent } from '../../lib/analytics';
import {
  fetchReport,
  scanSite,
  unlockReport,
  type Failure,
  type ScanOutcome,
} from '../../lib/checker/api';
import { MAX_COMPETITORS, industryLabel } from '../../lib/checker/config';
import * as copy from '../../lib/checker/copy';
import { displayHost, looksLikeSite, reportLink } from '../../lib/checker/format';
import type { FailReason, Report, ScanOk, UnlockFields } from '../../lib/checker/types';

export type View =
  | 'start'
  | 'checking'
  | 'failed'
  | 'grades'
  | 'loadingReport'
  | 'breakdown'
  | 'reportMissing';

export const failureMessage = (f: Failure): string => {
  switch (f.kind) {
    case 'rate_limited':
      return copy.RATE_LIMITED;
    case 'daily_cap':
      return copy.DAILY_CAP;
    case 'not_ready':
      return copy.NOT_READY;
    case 'verify':
      return copy.VERIFY_ERROR;
    case 'expired':
      return copy.EXPIRED;
    case 'bad_request':
      return copy.BAD_REQUEST;
    case 'timeout':
      return copy.NETWORK_ERROR;
    default:
      return copy.NETWORK_ERROR;
  }
};

/** The visitor-facing sentence for any scan outcome that is not a success. */
function scanMessage(out: Exclude<ScanOutcome, { kind: 'ok' }>, typed: string): { text: string; reason?: FailReason } {
  if (out.kind === 'fail') {
    const host = out.host || displayHost(typed);
    return { text: copy.FAILURE[out.reason](host), reason: out.reason };
  }
  if (out.kind === 'timeout') {
    return { text: copy.FAILURE.timeout(displayHost(typed)), reason: 'timeout' };
  }
  return { text: failureMessage(out) };
}

const emptyStart: StartValues = { website: '', industry: '', city: '' };

let rowKey = 1;
const newRow = (): CompetitorRow => ({ key: rowKey++, input: '', status: 'idle' });

export function useCheckerFlow(token: string | null, clearToken: () => void) {
  const [view, setView] = useState<View>(token ? 'loadingReport' : 'start');
  const [values, setValues] = useState<StartValues>(emptyStart);
  const [startError, setStartError] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ text: string; reason?: FailReason } | null>(null);
  const [scan, setScan] = useState<ScanOk | null>(null);
  const [busy, setBusy] = useState(false);
  const [recheckMessage, setRecheckMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<CompetitorRow[]>([newRow()]);
  const [report, setReport] = useState<Report | null>(null);
  const [reportToken, setReportToken] = useState<string | null>(token);
  const [emailedTo, setEmailedTo] = useState<string | null>(null);
  const [emailFailed, setEmailFailed] = useState(false);
  const [serverFields, setServerFields] = useState<UnlockFields | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  // Every start, reset and report load bumps this, so a late reply from an
  // older request cannot overwrite what the visitor is looking at now.
  const run = useRef(0);
  const trapRef = useRef('');
  const unlockViewed = useRef<string | null>(null);

  // A link with ?r=<token> opens the saved report. The page remounts this hook
  // (key) when the token changes, so the first render already shows "loading".
  useEffect(() => {
    if (!token) return;
    const mine = ++run.current;
    void fetchReport(token).then((out) => {
      if (mine !== run.current) return;
      if (out.kind === 'ok') {
        setReport(out.report);
        setEmailedTo(null);
        setView('breakdown');
      } else if (out.kind === 'not_found') {
        setView('reportMissing');
      } else {
        setFailure({ text: failureMessage(out) });
        setView('failed');
      }
    });
  }, [token]);

  // The unlock offer counts as seen once per scan.
  useEffect(() => {
    if (view === 'grades' && scan && unlockViewed.current !== scan.scan_id) {
      unlockViewed.current = scan.scan_id;
      trackEvent('checker_unlock_view');
    }
  }, [view, scan]);

  const doScan = useCallback(async (next: StartValues, force: boolean, honeypot: string) => {
    if (!next.industry) return;
    if (!looksLikeSite(next.website)) {
      setStartError(copy.FAILURE.invalid_url(''));
      setView('start');
      return;
    }
    const mine = ++run.current;
    setValues(next);
    setStartError(null);
    setRecheckMessage(null);
    trapRef.current = honeypot;
    trackEvent(force ? 'checker_recheck' : 'checker_scan_start');
    if (force) setBusy(true);
    else setView('checking');

    const out = await scanSite({ url: next.website.trim(), profile: next.industry, force }, honeypot);
    if (mine !== run.current) return;
    setBusy(false);

    if (out.kind === 'ok') {
      setScan(out.data);
      if (!force) {
        setRows([newRow()]);
        setReport(null);
        setEmailedTo(null);
        setEmailFailed(false);
        setServerFields(null);
        setUnlockError(null);
        setReportToken(null);
      }
      setView('grades');
      trackEvent('checker_scan_done', { grade: (out.data.overall ?? out.data.seo).grade });
      return;
    }

    const msg = scanMessage(out, next.website);
    trackEvent('checker_scan_failed', { reason: msg.reason ?? out.kind });
    if (force && msg.reason === 'recheck_too_soon') {
      setRecheckMessage(msg.text);
      return;
    }
    if (msg.reason === 'invalid_url') {
      setStartError(msg.text);
      setView('start');
      return;
    }
    setFailure(msg);
    setView('failed');
  }, []);

  const submitStart = useCallback(
    (next: StartValues, honeypot: string) => void doScan(next, false, honeypot),
    [doScan]
  );

  const recheck = useCallback(() => {
    if (scan) void doScan(values, true, trapRef.current);
  }, [doScan, scan, values]);

  const backToStart = useCallback(() => {
    run.current++;
    setBusy(false);
    setFailure(null);
    setStartError(null);
    setReport(null);
    setScan(null);
    setReportToken(null);
    setView('start');
    clearToken();
  }, [clearToken]);

  // Check again from the breakdown or a saved report: back to a fresh start.
  const checkAnother = useCallback(() => {
    trackEvent('checker_recheck');
    backToStart();
  }, [backToStart]);

  // ---- competitors ----
  const setRowInput = useCallback((key: number, input: string) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, input, status: 'idle', message: undefined } : r)));
  }, []);
  const addRow = useCallback(() => {
    setRows((rs) => (rs.length >= MAX_COMPETITORS ? rs : [...rs, newRow()]));
  }, []);
  const removeRow = useCallback((key: number) => {
    setRows((rs) => {
      const rest = rs.filter((r) => r.key !== key);
      return rest.length === 0 ? [newRow()] : rest;
    });
  }, []);

  const compare = useCallback(async () => {
    if (!values.industry || !scan) return;
    const mine = run.current;
    const todo = rows.filter((r) => r.status !== 'done' && r.input.trim() !== '');
    const seen = new Set(rows.filter((r) => r.status === 'done').map((r) => displayHost(r.input).toLowerCase()));
    for (const row of todo) {
      if (mine !== run.current) return;
      const host = displayHost(row.input).toLowerCase();
      if (!looksLikeSite(row.input)) {
        setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, status: 'failed', message: copy.FAILURE.invalid_url('') } : r)));
        continue;
      }
      const own = new Set([displayHost(scan.host), displayHost(values.website)].map((h) => h.toLowerCase()));
      if (own.has(host)) {
        setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, status: 'failed', message: copy.OWN_SITE } : r)));
        continue;
      }
      if (seen.has(host)) {
        setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, status: 'failed', message: 'You already added that site.' } : r)));
        continue;
      }
      seen.add(host);
      trackEvent('checker_competitor_added');
      setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, status: 'loading', message: undefined } : r)));
      const out = await scanSite({ url: row.input.trim(), profile: values.industry }, trapRef.current);
      if (mine !== run.current) return;
      if (out.kind === 'ok') {
        setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, status: 'done', scan: out.data } : r)));
      } else {
        const msg = scanMessage(out, row.input);
        trackEvent('checker_scan_failed', { reason: msg.reason ?? out.kind });
        setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, status: 'failed', message: msg.text } : r)));
        // A limit applies to every row that follows, so stop here.
        if (out.kind === 'rate_limited' || out.kind === 'daily_cap') return;
      }
    }
  }, [rows, scan, values.industry, values.website]);

  // ---- unlock ----
  const unlock = useCallback(
    async (form: UnlockValues | null, honeypot: string) => {
      if (!scan || !values.industry) return;
      const mine = run.current;
      setBusy(true);
      setUnlockError(null);
      setServerFields(null);
      const competitors = rows.filter((r) => r.status === 'done' && r.scan).map((r) => r.scan!.scan_id);
      const out = await unlockReport(
        {
          scanId: scan.scan_id,
          profile: values.industry,
          industry: industryLabel(values.industry),
          city: values.city.trim() || undefined,
          competitors,
          ...(form
            ? { name: form.name, email: form.email, phone: form.phone, okToCall: form.okToCall, consentText: copy.CHECKER_CONSENT_TEXT }
            : {}),
        },
        honeypot
      );
      if (mine !== run.current) return;
      setBusy(false);
      if (out.kind === 'ok') {
        setReport(out.report);
        setReportToken(out.reportToken);
        setEmailedTo(form && out.emailed ? form.email : null);
        setEmailFailed(Boolean(form) && !out.emailed);
        setView('breakdown');
        trackEvent('checker_unlock_done');
      } else if (out.kind === 'fields') {
        setServerFields(out.fields);
      } else {
        setUnlockError(failureMessage(out));
      }
    },
    [scan, rows, values.industry, values.city]
  );

  /** The optional "email me a copy" on the ungated path. Creates no lead. */
  const emailCopy = useCallback(
    async (email: string): Promise<'sent' | 'already' | 'failed'> => {
      if (!scan || !values.industry) return 'failed';
      const out = await unlockReport(
        { scanId: scan.scan_id, profile: values.industry, industry: industryLabel(values.industry), email },
        trapRef.current
      );
      if (out.kind !== 'ok') return 'failed';
      if (out.emailed) {
        setEmailedTo(email);
        return 'sent';
      }
      return 'already';
    },
    [scan, values.industry]
  );

  const help = useCallback((from: 'breakdown' | 'blocked') => {
    trackEvent('checker_help_click', { location: from });
    openConcierge({
      source: 'section_cta',
      quickReply: from === 'blocked' ? copy.PERSON_QUICK_REPLY : copy.HELP_QUICK_REPLY,
    });
  }, []);

  const copyLink = useCallback(async () => {
    if (!reportToken) return;
    const link = reportLink(reportToken);
    let ok = false;
    try {
      await navigator.clipboard.writeText(link);
      ok = true;
    } catch {
      // Older browsers: select a throwaway field and copy from it.
      const el = document.createElement('textarea');
      el.value = link;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      el.remove();
    }
    setCopyState(ok ? 'copied' : 'failed');
    if (ok) window.setTimeout(() => setCopyState('idle'), 2500);
  }, [reportToken]);

  return {
    view, values, startError, failure, scan, busy, recheckMessage, rows, report, emailedTo, emailFailed,
    serverFields, unlockError, copyState, reportToken,
    submitStart, recheck, backToStart, checkAnother, setRowInput, addRow, removeRow, compare,
    unlock, emailCopy, help, copyLink,
  };
}
