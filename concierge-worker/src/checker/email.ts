import { escapeHtml, type LeadEmail } from '../email';
import { clampLength, sanitizeText, stripHtml } from '../sanitize';
import { isRecord } from '../util';
import { gradeOf, isReadLimited, reportLink, cleanHost } from './lead';
import type { ActionPlan } from './plan';

const MAX_FIXES = 5;

const plain = (value: unknown, max: number): string =>
  typeof value === 'string' ? clampLength(sanitizeText(stripHtml(value)).replace(/\s+/g, ' ').trim(), max) : '';

interface Row {
  label: string;
  value: string;
}

const gradeRows = (report: Record<string, unknown>): Row[] => {
  const format = (value: unknown): string => {
    const grade = gradeOf(value);
    return grade ? `${grade.grade} (${grade.score})` : 'n/a';
  };
  const seo = { label: 'SEO', value: format(report.seo) };
  // A page that needs JavaScript cannot be read for Conversion, so neither it nor Overall is shown.
  return isReadLimited(report)
    ? [seo]
    : [{ label: 'Overall', value: format(report.overall) }, seo, { label: 'Conversion', value: format(report.conversion) }];
};

const topFixes = (report: Record<string, unknown>): Array<{ title: string; fix: string }> =>
  (Array.isArray(report.top_fixes) ? report.top_fixes : [])
    .slice(0, MAX_FIXES)
    .filter(isRecord)
    .map((fix) => ({ title: plain(fix.title, 120), fix: plain(fix.fix, 300) }))
    .filter((fix) => fix.title !== '');

const HELP = 'If you would like a hand with any of this, THG AI Services is happy to help, and you can reach us any time at thgservices.io.';
const LIMITED_NOTE = 'Only SEO could be graded, because this page needs JavaScript to show its content.';

/**
 * The one email a visitor gets: their grades, the top fixes and the action plan as plain text, a button to
 * the report, and one sentence offering help. No street address. Every color is a plain solid color with its
 * own explicit background, so a phone mail app that flips colors in dark mode still leaves text readable.
 */
export const buildReportEmail = (
  to: string,
  report: Record<string, unknown>,
  token: string,
  plan: ActionPlan | null,
): LeadEmail => {
  const host = cleanHost(report.host);
  const link = reportLink(token);
  const rows = gradeRows(report);
  const fixes = topFixes(report);
  const limited = isReadLimited(report);

  const text = [
    `Your website report for ${host}`,
    '',
    ...rows.map((row) => `${row.label}: ${row.value}`),
    ...(limited ? ['', LIMITED_NOTE] : []),
    '',
    ...(fixes.length > 0
      ? ['Fix these first', ...fixes.map((fix, i) => `${i + 1}. ${fix.title}${fix.fix ? `\n   ${fix.fix}` : ''}`), '']
      : []),
    ...(plan
      ? ['Your action plan', plan.summary, ...plan.items.map((item) => item.text), '']
      : []),
    `See your full report: ${link}`,
    '',
    HELP,
    '',
  ].join('\n');

  const color = { page: '#f1f5f9', card: '#ffffff', text: '#0f172a', muted: '#475569', button: '#1d4ed8', buttonText: '#ffffff' };
  const para = (value: string, extra = ''): string =>
    `<tr><td bgcolor="${color.card}" style="background-color:${color.card};color:${color.text};font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;padding:4px 24px;${extra}">${escapeHtml(value)}</td></tr>`;
  const heading = (value: string): string =>
    `<tr><td bgcolor="${color.card}" style="background-color:${color.card};color:${color.text};font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;padding:16px 24px 4px">${escapeHtml(value)}</td></tr>`;

  const html = [
    `<!doctype html><html><body style="margin:0;padding:0;background-color:${color.page}">`,
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${color.page}" style="background-color:${color.page}"><tr><td align="center" style="padding:16px">`,
    `<table role="presentation" width="560" cellspacing="0" cellpadding="0" bgcolor="${color.card}" style="background-color:${color.card};max-width:100%">`,
    `<tr><td bgcolor="${color.card}" style="background-color:${color.card};color:${color.text};font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;padding:24px 24px 8px">${escapeHtml(`Your website report for ${host}`)}</td></tr>`,
    ...rows.map((row) => para(`${row.label}: ${row.value}`, 'font-weight:bold;')),
    ...(limited ? [para(LIMITED_NOTE)] : []),
    ...(fixes.length > 0
      ? [heading('Fix these first'), ...fixes.map((fix, i) => para(`${i + 1}. ${fix.title}${fix.fix ? ` ${fix.fix}` : ''}`))]
      : []),
    ...(plan ? [heading('Your action plan'), para(plan.summary), ...plan.items.map((item) => para(item.text, 'padding-top:8px;'))] : []),
    `<tr><td bgcolor="${color.card}" style="background-color:${color.card};padding:20px 24px"><a href="${escapeHtml(link)}" style="background-color:${color.button};color:${color.buttonText};font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;text-decoration:none;padding:12px 24px;display:inline-block;border-radius:6px">See your full report</a></td></tr>`,
    para(HELP, 'padding-bottom:24px;'),
    '</table></td></tr></table></body></html>',
  ].join('');

  return { subject: clampLength(`Your website report for ${host}`, 200), text, html, to: [to] };
};
