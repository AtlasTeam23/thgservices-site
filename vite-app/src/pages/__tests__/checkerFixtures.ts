import { vi } from 'vitest';

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const g = (score: number) => ({
  score,
  grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 55 ? 'D' : 'F',
});

/** A stable UUID-shaped id for a host, like the ones the Worker returns. */
export function scanId(host: string): string {
  let h = 0x811c9dc5;
  const hex: string[] = [];
  for (let i = 0; hex.join('').length < 32; i++) {
    h ^= host.charCodeAt(i % host.length) + i;
    h = Math.imul(h, 16777619) >>> 0;
    hex.push(h.toString(16).padStart(8, '0'));
  }
  const x = hex.join('').slice(0, 32).split('');
  x[12] = '4';
  x[16] = '8';
  const j = x.join('');
  return `${j.slice(0, 8)}-${j.slice(8, 12)}-${j.slice(12, 16)}-${j.slice(16, 20)}-${j.slice(20, 32)}`;
}

export function scanBody(host: string, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    scan_id: scanId(host),
    host,
    final_url: `https://${host}/`,
    cached: false,
    checked_at: new Date().toISOString(),
    read_limited: false,
    bot_view: false,
    overall: g(71),
    seo: g(90),
    conversion: g(51),
    summary: {
      to_fix: 5,
      to_improve: 6,
      passing: 20,
      categories: [
        { id: 'seo.idx', section: 'seo', label: 'Getting listed by search engines', to_fix: 1, to_improve: 0, passing: 4 },
        { id: 'conversion.contact', section: 'conversion', label: 'Easy to contact', to_fix: 2, to_improve: 1, passing: 1 },
      ],
    },
    gated: true,
    ...extra,
  };
}

export const checks = [
  { id: 'seo.title_tag', title: 'Page title', status: 'warn', points: 5, max_points: 10, finding: '<code>Home &amp; Garden</code> (13 chars)', fix: 'Aim for <b>30-60</b> characters.' },
  { id: 'seo.meta', title: 'Search result description', status: 'fail', finding: 'Missing <img src=x onerror=alert(1)>', fix: 'Add a description.' },
  { id: 'conversion.call_to_action', title: 'Clear call to action', status: 'pass', finding: 'Found a clear one.', fix: '' },
  { id: 'conversion.phone', title: 'Tap-to-call phone number', status: 'fail', finding: 'No tap-to-call link on the page.', fix: 'Make your phone number a tap-to-call link.' },
];

export function reportBody(host: string, extra: Record<string, unknown> = {}) {
  return {
    host,
    final_url: `https://${host}/`,
    checked_at: new Date().toISOString(),
    read_limited: false,
    bot_view: false,
    overall: g(71),
    seo: g(90),
    conversion: g(51),
    top_fixes: [
      { check_id: 'seo.meta', title: 'Search result description', fix: 'Add a description.' },
      { check_id: 'conversion.phone', title: 'Tap-to-call phone number', fix: 'Make your phone number a tap-to-call link.' },
    ],
    sections: [
      { id: 'seo', title: 'SEO', subtitle: 'How easy you are to find in search.', categories: [{ id: 'seo.idx', label: 'Getting listed by search engines', checks: checks.slice(0, 2) }] },
      { id: 'conversion', title: 'Conversion', subtitle: 'How well your site turns visitors into leads.', categories: [{ id: 'conversion.cta', label: 'A clear next step', checks: checks.slice(2) }] },
    ],
    plan: { summary: 'Start with the phone link.', items: [{ check_id: 'conversion.phone', text: 'Turn your number into a tap-to-call link.' }] },
    ...extra,
  };
}

export const competitorEntry = (host: string, statuses: Record<string, string>) => ({
  host,
  final_url: `https://${host}/`,
  overall: g(88),
  seo: g(92),
  conversion: g(80),
  checks: checks.map((c) => ({ id: c.id, status: statuses[c.id] ?? 'pass' })),
});

/** A fetch stand-in: each path gets a handler; the call log is kept for assertions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeFetch(handlers: Record<string, (body: any, url: URL) => Response | Promise<Response>>) {
  return vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const handler = handlers[url.pathname];
    if (!handler) return json(404, {});
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    return handler(body, url);
  });
}

export const bodiesFor = (fetchMock: ReturnType<typeof makeFetch>, path: string) =>
  fetchMock.mock.calls
    .filter(([u]) => new URL(u).pathname === path)
    .map(([, init]) => (init?.body ? JSON.parse(String(init.body)) : undefined));
