import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const trackEvent = vi.fn();
vi.mock('../../lib/analytics', () => ({ trackEvent: (...a: unknown[]) => trackEvent(...a), trackPageView: vi.fn() }));
vi.mock('../../components/concierge/turnstile', () => ({ getToken: () => Promise.resolve(null) }));

import WebsiteChecker from '../WebsiteChecker';
import { ThemeProvider } from '../../lib/theme';
import { onConciergeOpen } from '../../components/concierge/events';
import { CHECKER_CONSENT_TEXT, FAILURE, READ_LIMITED_BANNER, RATE_LIMITED, DAILY_CAP } from '../../lib/checker/copy';
import { INDUSTRIES } from '../../lib/checker/config';
import { bodiesFor, competitorEntry, json, makeFetch, reportBody, scanBody, scanId } from './checkerFixtures';

const TOKEN = 'tok_abcdefghijklmnop1234567890';

function renderPage(url = '/website-checker') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[url]}>
        <WebsiteChecker />
      </MemoryRouter>
    </ThemeProvider>
  );
}

async function startScan(user: ReturnType<typeof userEvent.setup>, site = 'example.com', industry = 'trade') {
  await user.type(screen.getByLabelText('Your website'), site);
  await user.selectOptions(screen.getByLabelText('Your industry'), industry);
  await user.click(screen.getByRole('button', { name: 'Check my website' }));
}

const fillGated = async (user: ReturnType<typeof userEvent.setup>, phone = '(555) 123-4567') => {
  await user.type(screen.getByLabelText('Name'), 'Jane Owner');
  await user.type(screen.getByLabelText('Email'), 'jane@owner.example');
  await user.type(screen.getByLabelText('Phone'), phone);
};

describe('WebsiteChecker page', () => {
  let fetchMock: ReturnType<typeof makeFetch>;

  const installFetch = (handlers: Parameters<typeof makeFetch>[0]) => {
    fetchMock = makeFetch(handlers);
    vi.stubGlobal('fetch', fetchMock);
  };

  beforeEach(() => {
    vi.stubEnv('VITE_CONCIERGE_API_URL', 'https://worker.test');
    trackEvent.mockClear();
    window.history.replaceState({}, '', '/');
    document.head.querySelectorAll('meta[name=robots], meta[name=referrer]').forEach((m) => m.remove());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('start and grades', () => {
    it('shows the start screen copy and the six industries', () => {
      renderPage();
      expect(screen.getByRole('heading', { level: 1, name: 'Free website checker' })).toBeInTheDocument();
      expect(
        screen.getByText('See how easy your website is to find, and how well it turns visitors into customers.')
      ).toBeInTheDocument();
      expect(screen.getByPlaceholderText('yourcompany.com')).toBeInTheDocument();
      expect(screen.getByLabelText('City or ZIP (optional)')).toBeInTheDocument();
      expect(screen.getByText('Used for competitor comparison.')).toBeInTheDocument();
      expect(
        screen.getByText('Free. No account needed. We read your home page the way a search engine does.')
      ).toBeInTheDocument();
      const options = within(screen.getByLabelText('Your industry')).getAllByRole('option');
      expect(options.map((o) => o.textContent)).toEqual([
        'Choose your industry',
        'Home services (flooring, plumbing, HVAC, roofing, landscaping, cleaning)',
        'Professional services (law, accounting, consulting, insurance, real estate)',
        'Health and wellness (dental, medical, chiropractic, therapy, fitness, salon)',
        'Restaurants and retail',
        'Software and online services',
        'Other local business',
      ]);
      expect(INDUSTRIES.map((i) => i.value)).toEqual(['trade', 'professional', 'health', 'retail', 'software', 'general']);
    });

    it('runs a scan with the chosen profile and shows the three grades, counts and categories only', async () => {
      installFetch({ '/checker/scan': () => json(200, scanBody('example.com')) });
      const user = userEvent.setup();
      renderPage();
      await user.type(screen.getByLabelText('City or ZIP (optional)'), '30189');
      await startScan(user, 'example.com', 'health');

      expect(await screen.findByRole('heading', { name: 'example.com' })).toBeInTheDocument();
      expect(bodiesFor(fetchMock, '/checker/scan')).toEqual([
        { url: 'example.com', profile: 'health', company_website: '' },
      ]);
      expect(screen.getByRole('img', { name: 'Overall grade C, 71 out of 100' })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'SEO grade A, 90 out of 100' })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Conversion grade F, 51 out of 100' })).toBeInTheDocument();
      expect(screen.getByText('How easy you are to find in search.')).toBeInTheDocument();
      expect(screen.getByText('How well your site turns visitors into leads.')).toBeInTheDocument();
      expect(screen.getByText('5 to fix, 6 to improve, 20 passing.')).toBeInTheDocument();
      expect(screen.getByText('Getting listed by search engines')).toBeInTheDocument();
      expect(screen.getByText('Easy to contact')).toBeInTheDocument();
      // No check names or findings before the form.
      expect(screen.queryByText('Page title')).not.toBeInTheDocument();
      expect(screen.queryByTestId('breakdown')).not.toBeInTheDocument();
      // Not cached: no "Checked ... ago" line.
      expect(screen.queryByText(/^Checked /)).not.toBeInTheDocument();
    });

    it('needs an industry and a plausible address before it spends a scan', async () => {
      installFetch({ '/checker/scan': () => json(200, scanBody('example.com')) });
      const user = userEvent.setup();
      renderPage();
      await user.type(screen.getByLabelText('Your website'), 'example.com');
      await user.click(screen.getByRole('button', { name: 'Check my website' }));
      expect(screen.getByText('Choose the closest industry.')).toBeInTheDocument();

      await user.clear(screen.getByLabelText('Your website'));
      await user.type(screen.getByLabelText('Your website'), 'not a site');
      await user.selectOptions(screen.getByLabelText('Your industry'), 'trade');
      await user.click(screen.getByRole('button', { name: 'Check my website' }));
      expect(screen.getByText('Enter a website address like yourcompany.com.')).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shows a plain spinner while checking', async () => {
      let release: (r: Response) => void = () => {};
      installFetch({ '/checker/scan': () => new Promise<Response>((r) => (release = r)) });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      expect(await screen.findByText('Checking your home page. This usually takes a few seconds.')).toBeInTheDocument();
      release(json(200, scanBody('example.com')));
      expect(await screen.findByRole('heading', { name: 'example.com' })).toBeInTheDocument();
    });

    it('shows the cached line and re-checks with force', async () => {
      installFetch({
        '/checker/scan': (body) =>
          json(200, scanBody('example.com', { cached: true, checked_at: new Date(Date.now() - 5 * 60000).toISOString(), ...(body.force ? { cached: false } : {}) })),
      });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      expect(await screen.findByText('Checked 5 minutes ago.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Check again' }));
      await waitFor(() => expect(bodiesFor(fetchMock, '/checker/scan')).toHaveLength(2));
      expect(bodiesFor(fetchMock, '/checker/scan')[1]).toMatchObject({ force: true });
      await waitFor(() => expect(screen.queryByText(/^Checked /)).not.toBeInTheDocument());
      expect(trackEvent).toHaveBeenCalledWith('checker_recheck');
    });

    it('keeps the grades and says so when a re-check comes too soon', async () => {
      installFetch({
        '/checker/scan': (body) =>
          body.force ? json(200, { ok: false, host: 'example.com', reason: 'recheck_too_soon' }) : json(200, scanBody('example.com', { cached: true })),
      });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      await user.click(await screen.findByRole('button', { name: 'Check again' }));
      expect(await screen.findByText('We just checked this site. Try again in a few minutes.')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'SEO grade A, 90 out of 100' })).toBeInTheDocument();
    });
  });

  describe('failures', () => {
    const reasons = [
      'blocked', 'no_response', 'not_found', 'site_error', 'timeout', 'not_html', 'too_large', 'invalid_url', 'recheck_too_soon',
    ] as const;

    it.each(reasons)('renders the message for %s', async (reason) => {
      installFetch({ '/checker/scan': () => json(200, { ok: false, host: 'example.com', reason }) });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      const expected = FAILURE[reason]('example.com');
      expect(await screen.findByText(expected)).toBeInTheDocument();
      expect(trackEvent).toHaveBeenCalledWith('checker_scan_failed', { reason });
    });

    it('uses the exact wording from the spec', () => {
      expect(FAILURE.blocked('x')).toBe(
        "This site blocks automated checks, so we can't grade it. That's common with security settings and doesn't mean anything is wrong."
      );
      expect(FAILURE.no_response('a.com')).toBe(
        "We couldn't reach a.com. Check the spelling and make sure the site is live."
      );
      expect(FAILURE.too_large('x')).toBe(
        'This home page is over 3 MB, which is too big for us to read. A page that size is slow to open on phones too.'
      );
      expect(RATE_LIMITED).toBe("You've run several checks in a row. Try again in a few minutes.");
      expect(DAILY_CAP).toBe("We've run a lot of checks today. Try again tomorrow.");
      expect(READ_LIMITED_BANNER).toBe(
        "We could only read part of this site. Your home page sends almost no text until JavaScript runs, so we can't grade how it turns visitors into leads. Search engines and AI tools can have the same trouble."
      );
    });

    it('invalid_url from the server returns to the form with the message beside the field', async () => {
      installFetch({ '/checker/scan': () => json(200, { ok: false, host: 'x', reason: 'invalid_url' }) });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      expect(await screen.findByRole('alert')).toHaveTextContent('Enter a website address like yourcompany.com.');
      expect(screen.getByLabelText('Your website')).toHaveValue('example.com');
    });

    it('blocked offers "Ask a person to look", which opens the chat with a quick reply the chat knows', async () => {
      installFetch({ '/checker/scan': () => json(200, { ok: false, host: 'example.com', reason: 'blocked', http_status: 403 }) });
      const handler = vi.fn();
      const off = onConciergeOpen(handler);
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      await user.click(await screen.findByRole('button', { name: 'Ask a person to look' }));
      off();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].quickReply).toMatch(/person to look/);
      expect(trackEvent).toHaveBeenCalledWith('checker_help_click', { location: 'blocked' });
    });

    it('other failures do not offer it, and "Try another website" returns to the form', async () => {
      installFetch({ '/checker/scan': () => json(200, { ok: false, host: 'example.com', reason: 'timeout' }) });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      await screen.findByText(FAILURE.timeout('example.com'));
      expect(screen.queryByRole('button', { name: 'Ask a person to look' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Try another website' }));
      expect(screen.getByLabelText('Your website')).toHaveValue('example.com');
    });

    it.each([
      [429, { error: 'rate_limited' }, RATE_LIMITED],
      [503, { error: 'capacity' }, DAILY_CAP],
    ])('renders the limit message for %s %j', async (status, body, text) => {
      installFetch({ '/checker/scan': () => json(status, body) });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      expect(await screen.findByText(text)).toBeInTheDocument();
    });
  });

  describe('read-limited sites', () => {
    it('shows the banner and the SEO gauge but no Overall or Conversion gauge', async () => {
      installFetch({
        '/checker/scan': () => json(200, scanBody('example.com', { read_limited: true, overall: null, conversion: null })),
      });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      expect(await screen.findByText(READ_LIMITED_BANNER)).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'SEO grade A, 90 out of 100' })).toBeInTheDocument();
      expect(screen.queryByTestId('gauge-overall')).not.toBeInTheDocument();
      expect(screen.queryByTestId('gauge-conversion')).not.toBeInTheDocument();
      expect(trackEvent).toHaveBeenCalledWith('checker_scan_done', { grade: 'A' });
    });
  });

  describe('the gate', () => {
    const gatedHandlers = () => ({
      '/checker/scan': () => json(200, scanBody('example.com')),
      '/checker/unlock': () => json(200, { ok: true, report_token: TOKEN, report: reportBody('example.com'), emailed: true }),
    });

    it('requires a name, an email and a 10-digit phone, and does not send until they are right', async () => {
      installFetch(gatedHandlers());
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      await screen.findByRole('heading', { name: 'Get your full breakdown, free' });
      expect(screen.getByText('Every check, what we found, and how to fix it.')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Show my breakdown' }));
      expect(screen.getByText('Enter your name.')).toBeInTheDocument();
      expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
      expect(screen.getByText('Enter a 10-digit phone number.')).toBeInTheDocument();

      await fillGated(user, '555-123');
      await user.click(screen.getByRole('button', { name: 'Show my breakdown' }));
      expect(screen.getByText('Enter a 10-digit phone number.')).toBeInTheDocument();
      expect(bodiesFor(fetchMock, '/checker/unlock')).toHaveLength(0);
    });

    it('has no consent checkbox and puts the consent text directly above the button', async () => {
      installFetch(gatedHandlers());
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      await screen.findByLabelText('Phone');
      await user.type(screen.getByLabelText('Phone'), '5');
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('OK to call or text me about my results')).not.toBeInTheDocument();
      expect(CHECKER_CONSENT_TEXT).toBe(
        'By tapping Show my breakdown you agree that THG AI Services may call you, including with an automated AI assistant, and text or email you about your website results. You can opt out at any time.',
      );
      const consent = screen.getByText(new RegExp(CHECKER_CONSENT_TEXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      const button = screen.getByRole('button', { name: 'Show my breakdown' });
      expect(consent.nextElementSibling).toBe(button);
      expect(button).toHaveAccessibleDescription(CHECKER_CONSENT_TEXT + ' Privacy policy.');
      expect(screen.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy.html#website-checker');
    });

    it('sends the details, the profile, city and finished competitors, then shows the breakdown with the email line', async () => {
      installFetch({
        ...gatedHandlers(),
        '/checker/scan': (body) => json(200, scanBody(body.url)),
      });
      const user = userEvent.setup();
      renderPage();
      await user.type(screen.getByLabelText('City or ZIP (optional)'), 'Woodstock');
      await startScan(user, 'example.com', 'professional');
      await user.type(await screen.findByLabelText('Competitor 1 website'), 'rival.com');
      await user.click(screen.getByRole('button', { name: 'Compare' }));
      await screen.findByTestId('competitor-grades');
      await fillGated(user);
      await user.click(screen.getByRole('button', { name: 'Show my breakdown' }));

      expect(await screen.findByTestId('breakdown')).toBeInTheDocument();
      expect(bodiesFor(fetchMock, '/checker/unlock')).toEqual([
        {
          scanId: scanId('example.com'),
          profile: 'professional',
          industry: 'Professional services (law, accounting, consulting, insurance, real estate)',
          city: 'Woodstock',
          competitors: [scanId('rival.com')],
          name: 'Jane Owner',
          email: 'jane@owner.example',
          phone: '(555) 123-4567',
          okToCall: true,
          consentText: CHECKER_CONSENT_TEXT,
          company_website: '',
        },
      ]);
      expect(screen.getByText('We emailed a copy to jane@owner.example.')).toBeInTheDocument();
      expect(trackEvent).toHaveBeenCalledWith('checker_unlock_view');
      expect(trackEvent).toHaveBeenCalledWith('checker_unlock_done');
    });

    it('shows the server\'s field errors from a 400 and keeps the form', async () => {
      installFetch({
        ...gatedHandlers(),
        '/checker/unlock': () => json(400, { ok: false, fields: { phone: 'That number does not look right.', email: 'Use a real email.' } }),
      });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      await screen.findByLabelText('Name');
      await fillGated(user);
      await user.click(screen.getByRole('button', { name: 'Show my breakdown' }));
      expect(await screen.findByText('That number does not look right.')).toBeInTheDocument();
      expect(screen.getByText('Use a real email.')).toBeInTheDocument();
      expect(screen.queryByTestId('breakdown')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Name')).toHaveValue('Jane Owner');
    });

    it('says so when the email could not be sent, and still shows the report', async () => {
      installFetch({
        ...gatedHandlers(),
        '/checker/unlock': () => json(200, { ok: true, report_token: TOKEN, report: reportBody('example.com'), emailed: false }),
      });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      await screen.findByLabelText('Name');
      await fillGated(user);
      await user.click(screen.getByRole('button', { name: 'Show my breakdown' }));
      expect(await screen.findByTestId('breakdown')).toBeInTheDocument();
      expect(screen.queryByText(/We emailed a copy/)).not.toBeInTheDocument();
      expect(screen.getByText(/couldn't email a copy just now/)).toBeInTheDocument();
    });

    it('skips the form when the visitor is not gated, and offers an optional email copy afterwards', async () => {
      installFetch({
        '/checker/scan': () => json(200, scanBody('example.com', { gated: false })),
        '/checker/unlock': (body) =>
          json(200, { ok: true, report_token: TOKEN, report: reportBody('example.com'), emailed: Boolean(body.email) }),
      });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      await screen.findByRole('heading', { name: 'example.com' });
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Phone')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Show my breakdown' }));
      expect(await screen.findByTestId('breakdown')).toBeInTheDocument();
      expect(bodiesFor(fetchMock, '/checker/unlock')).toEqual([
        {
          scanId: scanId('example.com'),
          profile: 'trade',
          industry: 'Home services (flooring, plumbing, HVAC, roofing, landscaping, cleaning)',
          company_website: '',
        },
      ]);
      expect(screen.queryByText(/We emailed a copy/)).not.toBeInTheDocument();

      await user.type(screen.getByLabelText('Email me a copy'), 'me@owner.example');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      expect(await screen.findByText('We emailed a copy to me@owner.example.')).toBeInTheDocument();
      expect(bodiesFor(fetchMock, '/checker/unlock')[1]).toEqual({
        scanId: scanId('example.com'),
        profile: 'trade',
        industry: 'Home services (flooring, plumbing, HVAC, roofing, landscaping, cleaning)',
        email: 'me@owner.example',
        company_website: '',
      });
    });
  });

  describe('competitors', () => {
    const handlers = () => ({
      '/checker/scan': (body: { url: string }) =>
        body.url.startsWith('bad')
          ? json(200, { ok: false, host: body.url, reason: 'no_response' })
          : json(200, scanBody(body.url)),
    });

    it('adds up to three, grades each with the same profile, and shows their grades beside the visitor\'s', async () => {
      installFetch(handlers());
      const user = userEvent.setup();
      renderPage();
      await startScan(user, 'example.com', 'software');
      await screen.findByText('Compare with competitors');
      await user.click(screen.getByRole('button', { name: 'Add another' }));
      await user.click(screen.getByRole('button', { name: 'Add another' }));
      expect(screen.queryByRole('button', { name: 'Add another' })).not.toBeInTheDocument();
      expect(screen.getByLabelText('Competitor 3 website')).toBeInTheDocument();
      expect(screen.queryByLabelText('Competitor 4 website')).not.toBeInTheDocument();

      await user.type(screen.getByLabelText('Competitor 1 website'), 'one.com');
      await user.type(screen.getByLabelText('Competitor 2 website'), 'two.com');
      await user.type(screen.getByLabelText('Competitor 3 website'), 'three.com');
      await user.click(screen.getByRole('button', { name: 'Compare' }));

      const table = await screen.findByTestId('competitor-grades');
      await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(5)); // header + you + 3
      expect(within(table).getByText('Your site')).toBeInTheDocument();
      for (const host of ['one.com', 'two.com', 'three.com']) expect(within(table).getByText(host)).toBeInTheDocument();
      expect(within(table).getAllByLabelText('Overall grade C')).toHaveLength(4);
      const scans = bodiesFor(fetchMock, '/checker/scan');
      expect(scans.map((b) => b.url)).toEqual(['example.com', 'one.com', 'two.com', 'three.com']);
      expect(scans.every((b) => b.profile === 'software')).toBe(true);
      expect(trackEvent.mock.calls.filter(([n]) => n === 'checker_competitor_added')).toHaveLength(3);
    });

    it('shows a competitor\'s failure on its own row and lets the others through', async () => {
      installFetch(handlers());
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      await user.click(await screen.findByRole('button', { name: 'Add another' }));
      await user.type(screen.getByLabelText('Competitor 1 website'), 'bad-one.com');
      await user.type(screen.getByLabelText('Competitor 2 website'), 'good.com');
      await user.click(screen.getByRole('button', { name: 'Compare' }));
      expect(await screen.findByText("We couldn't reach bad-one.com. Check the spelling and make sure the site is live.")).toBeInTheDocument();
      const table = await screen.findByTestId('competitor-grades');
      expect(within(table).getByText('good.com')).toBeInTheDocument();
    });

    it('lets a competitor be removed', async () => {
      installFetch(handlers());
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      await user.type(await screen.findByLabelText('Competitor 1 website'), 'one.com');
      await user.click(screen.getByRole('button', { name: 'Remove competitor 1' }));
      expect(screen.getByLabelText('Competitor 1 website')).toHaveValue('');
    });
  });

  describe('breakdown', () => {
    async function openBreakdown(extraReport: Record<string, unknown> = {}) {
      installFetch({
        '/checker/scan': () => json(200, scanBody('example.com')),
        '/checker/unlock': () =>
          json(200, { ok: true, report_token: TOKEN, report: reportBody('example.com', extraReport), emailed: true }),
      });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      await screen.findByLabelText('Name');
      await fillGated(user);
      await user.click(screen.getByRole('button', { name: 'Show my breakdown' }));
      await screen.findByTestId('breakdown');
      return user;
    }

    it('renders the plan, "Fix these first", both sections by category, status chips, findings and fixes', async () => {
      await openBreakdown();
      expect(screen.getByRole('heading', { name: 'Your action plan' })).toBeInTheDocument();
      expect(screen.getByText('Start with the phone link.')).toBeInTheDocument();
      expect(screen.getByText('Turn your number into a tap-to-call link.')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Fix these first' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'SEO' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Conversion' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Getting listed by search engines' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'A clear next step' })).toBeInTheDocument();
      expect(screen.getByText('Needs work')).toBeInTheDocument();
      expect(screen.getByText('Pass')).toBeInTheDocument();
      expect(screen.getAllByText('Fail').length).toBeGreaterThan(0);
      // The finding's <code> and <b> are real elements; an <img> in page text is not.
      expect(screen.getByText('Home & Garden', { selector: 'code' })).toBeInTheDocument();
      expect(screen.getByText('30-60', { selector: 'b' })).toBeInTheDocument();
      expect(document.querySelector('.ck-breakdown img')).toBeNull();
      expect(screen.getByText(/Missing <img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
      expect(
        screen.getByText("This is an automated check of your home page's public code. It doesn't measure real load time or guarantee search rankings.")
      ).toBeInTheDocument();
    });

    it('leaves the plan out when there is none', async () => {
      await openBreakdown({ plan: null });
      expect(screen.queryByRole('heading', { name: 'Your action plan' })).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Fix these first' })).toBeInTheDocument();
    });

    it('renders the competitor table and highlights the checks where a competitor does better', async () => {
      await openBreakdown({
        competitors: [
          competitorEntry('rival.com', { 'seo.title_tag': 'pass', 'seo.meta': 'fail', 'conversion.phone': 'pass' }),
          competitorEntry('other.org', { 'seo.title_tag': 'fail', 'seo.meta': 'fail', 'conversion.phone': 'fail' }),
        ],
      });
      expect(screen.getByRole('heading', { name: 'How you compare' })).toBeInTheDocument();
      const gaps = Array.from(document.querySelectorAll('tr[data-gap="true"]')).map((r) => r.textContent);
      // The visitor's gaps: title (rival passes) and phone (rival passes). The description is a fail for everyone.
      expect(gaps).toHaveLength(2);
      expect(gaps[0]).toContain('Page title');
      expect(gaps[0]).toContain('1 of 2 competitors pass');
      expect(gaps[1]).toContain('Tap-to-call phone number');
      // Passing rows are not highlighted.
      expect(document.querySelector('tr[data-gap="false"]')?.textContent).toMatch(/Search result description|Clear call to action/);
      expect(screen.getByTestId('gap-count')).toHaveTextContent('2 checks where a competitor does better.');
      expect(screen.getAllByText('rival.com').length).toBeGreaterThan(0);
    });

    it('"Get help fixing this" opens the chat with a quick reply the chat accepts', async () => {
      const user = await openBreakdown();
      const handler = vi.fn();
      const off = onConciergeOpen(handler);
      await user.click(screen.getByRole('button', { name: 'Get help fixing this' }));
      off();
      expect(handler).toHaveBeenCalledWith({
        source: 'section_cta',
        quickReply: 'I just checked my website and want help with the results',
      });
      expect(trackEvent).toHaveBeenCalledWith('checker_help_click', { location: 'breakdown' });
    });

    it('copies a report link that carries the token, and shows that it did', async () => {
      const user = await openBreakdown();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      await user.click(screen.getByRole('button', { name: 'Copy link to this report' }));
      expect(writeText).toHaveBeenCalledWith(`https://thgservices.io/website-checker/?r=${TOKEN}`);
      expect(window.location.origin).not.toBe('https://thgservices.io');
      expect(await screen.findByRole('button', { name: 'Link copied' })).toBeInTheDocument();
    });

    it('"Check again" returns to the start screen with the same website', async () => {
      const user = await openBreakdown();
      await user.click(screen.getByRole('button', { name: 'Check again' }));
      expect(screen.getByRole('button', { name: 'Check my website' })).toBeInTheDocument();
      expect(screen.getByLabelText('Your website')).toHaveValue('example.com');
    });
  });

  describe('report link mode', () => {
    const meta = (name: string) => document.head.querySelector(`meta[name="${name}"]`);

    it('fetches the report by token, shows it without the email line, and sets noindex and no-referrer', async () => {
      installFetch({ '/checker/report': () => json(200, { ok: true, report: reportBody('example.com') }) });
      const view = renderPage(`/website-checker?r=${TOKEN}`);
      expect(meta('robots')).toHaveAttribute('content', 'noindex');
      expect(meta('referrer')).toHaveAttribute('content', 'no-referrer');
      expect(await screen.findByTestId('breakdown')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`https://worker.test/checker/report?r=${TOKEN}`);
      expect(init?.method).toBe('GET');
      expect(screen.queryByText(/We emailed a copy/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Email me a copy')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Report for example.com' })).toBeInTheDocument();
      view.unmount();
      expect(meta('robots')).toBeNull();
      expect(meta('referrer')).toBeNull();
    });

    it('adds no robots or referrer tag on the plain page', () => {
      renderPage();
      expect(meta('robots')).toBeNull();
      expect(meta('referrer')).toBeNull();
    });

    it('says so when the report is not found, and "Check a website" drops the token and the tags', async () => {
      installFetch({ '/checker/report': () => json(404, { ok: false, reason: 'not_found' }) });
      const user = userEvent.setup();
      renderPage(`/website-checker?r=${TOKEN}`);
      expect(await screen.findByText(/couldn't find that report/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Check a website' }));
      expect(screen.getByRole('button', { name: 'Check my website' })).toBeInTheDocument();
      expect(meta('robots')).toBeNull();
      expect(meta('referrer')).toBeNull();
    });

    it('does not even ask the server about a token that cannot be one', async () => {
      installFetch({ '/checker/report': () => json(200, { ok: true, report: reportBody('x.com') }) });
      renderPage('/website-checker?r=short');
      expect(await screen.findByText(/couldn't find that report/)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('analytics', () => {
    it('sends event names and letters only: never a host, name, email, phone or token', async () => {
      installFetch({
        '/checker/scan': (body) => json(200, scanBody(body.url)),
        '/checker/unlock': () => json(200, { ok: true, report_token: TOKEN, report: reportBody('example.com'), emailed: true }),
      });
      const user = userEvent.setup();
      renderPage();
      await user.type(screen.getByLabelText('City or ZIP (optional)'), '30189');
      await startScan(user, 'my-secret-host.com');
      await user.type(await screen.findByLabelText('Competitor 1 website'), 'competitor-host.com');
      await user.click(screen.getByRole('button', { name: 'Compare' }));
      await screen.findByTestId('competitor-grades');
      await fillGated(user);
      await user.click(screen.getByRole('button', { name: 'Show my breakdown' }));
      await screen.findByTestId('breakdown');
      await user.click(screen.getByRole('button', { name: 'Get help fixing this' }));

      const names = trackEvent.mock.calls.map(([n]) => n);
      expect(names).toEqual(
        expect.arrayContaining([
          'checker_scan_start',
          'checker_scan_done',
          'checker_unlock_view',
          'checker_competitor_added',
          'checker_unlock_done',
          'checker_help_click',
        ])
      );
      expect(names.every((n: string) => n.startsWith('checker_'))).toBe(true);
      const everything = JSON.stringify(trackEvent.mock.calls);
      for (const secret of ['my-secret-host', 'competitor-host', 'jane', 'owner.example', '555', '123-4567', TOKEN, '30189', 'Jane']) {
        expect(everything).not.toContain(secret);
      }
      expect(trackEvent).toHaveBeenCalledWith('checker_scan_done', { grade: 'C' });
    });
  });

  describe('Worker contract and robustness', () => {
    const unlockOk = (extra: Record<string, unknown> = {}) =>
      json(200, { ok: true, report_token: TOKEN, report: reportBody('example.com'), emailed: true, ...extra });

    it('shows a generic message when a 400 has no field the form can show', async () => {
      installFetch({
        '/checker/scan': () => json(200, scanBody('example.com')),
        '/checker/unlock': () => json(400, { ok: false, fields: { scanId: 'bad' } }),
      });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      await screen.findByLabelText('Name');
      await fillGated(user);
      await user.click(screen.getByRole('button', { name: 'Show my breakdown' }));
      expect(await screen.findByText('Something was off with that request. Run the check again.')).toBeInTheDocument();
    });

    it('says the check expired when unlock answers not_found', async () => {
      installFetch({
        '/checker/scan': () => json(200, scanBody('example.com')),
        '/checker/unlock': () => json(404, { ok: false, reason: 'not_found' }),
      });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      await screen.findByLabelText('Name');
      await fillGated(user);
      await user.click(screen.getByRole('button', { name: 'Show my breakdown' }));
      expect(await screen.findByText('That check has expired. Run the check again.')).toBeInTheDocument();
    });

    it('maps verification_failed and capacity on a scan', async () => {
      installFetch({ '/checker/scan': () => json(403, { error: 'verification_failed' }) });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      expect(await screen.findByText("We couldn't verify your browser. Reload the page and try again.")).toBeInTheDocument();
    });

    it('treats a missing "gated" as gated', async () => {
      const body = scanBody('example.com') as Record<string, unknown>;
      delete body.gated;
      installFetch({ '/checker/scan': () => json(200, body) });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      expect(await screen.findByLabelText('Phone')).toBeInTheDocument();
    });

    it('renders the counts line when the summary has no categories', async () => {
      const body = scanBody('example.com');
      installFetch({ '/checker/scan': () => json(200, { ...body, summary: { to_fix: 1, to_improve: 2, passing: 3 } }) });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      expect(await screen.findByText('1 to fix, 2 to improve, 3 passing.')).toBeInTheDocument();
    });

    it('sends okToCall: true on every gated unlock, since the submit is the acceptance', async () => {
      installFetch({
        '/checker/scan': () => json(200, scanBody('example.com')),
        '/checker/unlock': () => unlockOk(),
      });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      await screen.findByLabelText('Name');
      await fillGated(user);
      await user.click(screen.getByRole('button', { name: 'Show my breakdown' }));
      await screen.findByTestId('breakdown');
      expect(bodiesFor(fetchMock, '/checker/unlock')[0].okToCall).toBe(true);
    });

    it('focuses the first invalid field on a failed submit', async () => {
      installFetch({ '/checker/scan': () => json(200, scanBody('example.com')) });
      const user = userEvent.setup();
      renderPage();
      await user.type(screen.getByLabelText('Your website'), 'example.com');
      await user.click(screen.getByRole('button', { name: 'Check my website' }));
      expect(screen.getByLabelText('Your industry')).toHaveFocus();
      await user.selectOptions(screen.getByLabelText('Your industry'), 'trade');
      await user.click(screen.getByRole('button', { name: 'Check my website' }));
      await screen.findByLabelText('Name');
      await user.click(screen.getByRole('button', { name: 'Show my breakdown' }));
      expect(screen.getByLabelText('Name')).toHaveFocus();
    });

    it('moves focus to the heading when returning to the start screen', async () => {
      installFetch({ '/checker/scan': () => json(200, { ok: false, host: 'example.com', reason: 'timeout' }) });
      const user = userEvent.setup();
      renderPage();
      await startScan(user);
      await user.click(await screen.findByRole('button', { name: 'Try another website' }));
      expect(screen.getByRole('heading', { level: 1, name: 'Free website checker' })).toHaveFocus();
    });

    it('keeps the hidden field out of reach: off-screen class, no tab stop, no autofill, hidden from readers', () => {
      renderPage();
      const trap = document.querySelector('input[name="company_website"]') as HTMLInputElement;
      expect(trap.getAttribute('autocomplete')).toBe('off');
      expect(trap.getAttribute('tabindex')).toBe('-1');
      expect(trap.getAttribute('aria-hidden')).toBe('true');
      expect(trap.closest('.ck-trap')).not.toBeNull();
    });

    describe('competitors', () => {
      it('rejects the visitor\'s own website', async () => {
        installFetch({ '/checker/scan': (b: { url: string }) => json(200, scanBody(b.url.replace(/^www\./, ''))) });
        const user = userEvent.setup();
        renderPage();
        await startScan(user, 'example.com');
        await user.type(await screen.findByLabelText('Competitor 1 website'), 'https://www.Example.com/');
        await user.click(screen.getByRole('button', { name: 'Compare' }));
        expect(await screen.findByText('That is your own website. Enter a competitor.')).toBeInTheDocument();
        expect(bodiesFor(fetchMock, '/checker/scan')).toHaveLength(1);
      });

      it('stops after a rate limit and does not try the rest', async () => {
        installFetch({
          '/checker/scan': (b: { url: string }) =>
            b.url === 'one.com' ? json(429, { error: 'rate_limited' }) : json(200, scanBody(b.url)),
        });
        const user = userEvent.setup();
        renderPage();
        await startScan(user, 'example.com');
        await user.click(await screen.findByRole('button', { name: 'Add another' }));
        await user.type(screen.getByLabelText('Competitor 1 website'), 'one.com');
        await user.type(screen.getByLabelText('Competitor 2 website'), 'two.com');
        await user.click(screen.getByRole('button', { name: 'Compare' }));
        expect(await screen.findByText(RATE_LIMITED)).toBeInTheDocument();
        expect(bodiesFor(fetchMock, '/checker/scan').map((b) => b.url)).toEqual(['example.com', 'one.com']);
      });

      it('has a polite live region while a competitor is being checked', async () => {
        let release: (r: Response) => void = () => {};
        installFetch({
          '/checker/scan': (b: { url: string }) =>
            b.url === 'example.com' ? json(200, scanBody('example.com')) : new Promise<Response>((r) => (release = r)),
        });
        const user = userEvent.setup();
        renderPage();
        await startScan(user);
        await user.type(await screen.findByLabelText('Competitor 1 website'), 'one.com');
        await user.click(screen.getByRole('button', { name: 'Compare' }));
        const live = await screen.findByText('Checking competitor websites.');
        expect(live).toHaveAttribute('aria-live', 'polite');
        release(json(200, scanBody('one.com')));
        await screen.findByTestId('competitor-grades');
      });
    });

    describe('breakdown details', () => {
      async function open(handlers: Record<string, () => Response> = {}) {
        installFetch({
          '/checker/scan': () => json(200, scanBody('example.com', { gated: false })),
          '/checker/unlock': () => unlockOk({ report: reportBody('example.com', { competitors: [competitorEntry('rival.com', {})] }) }),
          ...handlers,
        });
        const user = userEvent.setup();
        renderPage();
        await startScan(user);
        await user.click(await screen.findByRole('button', { name: 'Show my breakdown' }));
        await screen.findByTestId('breakdown');
        return user;
      }

      it('announces each comparison cell as Pass, Needs work or Fail, not by color alone', async () => {
        await open();
        const cells = Array.from(document.querySelectorAll('.ck-table--checks td [aria-label]'));
        expect(cells.length).toBeGreaterThan(0);
        for (const c of cells) {
          expect(c).toHaveAttribute('role', 'img');
          expect(['Pass', 'Needs work', 'Fail', 'Not compared']).toContain(c.getAttribute('aria-label'));
        }
        expect(document.querySelectorAll('.ck-table--grades [role="img"]').length).toBeGreaterThan(0);
      });

      it('shows "We already sent a copy" when the second answer is emailed:false', async () => {
        const user = await open({
          '/checker/unlock': (() => {
            let n = 0;
            return () => unlockOk({ emailed: n++ === 0 });
          })(),
        });
        await user.type(screen.getByLabelText('Email me a copy'), 'me@owner.example');
        await user.click(screen.getByRole('button', { name: 'Send' }));
        expect(await screen.findByText('We already sent a copy to that address today.')).toBeInTheDocument();
        expect(screen.queryByText(/We emailed a copy/)).not.toBeInTheDocument();
      });

      it('shows the link to select when both copy methods fail', async () => {
        const user = await open();
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
        document.execCommand = vi.fn().mockReturnValue(false);
        await user.click(screen.getByRole('button', { name: 'Copy link to this report' }));
        expect(await screen.findByText("Couldn't copy, select the link instead.")).toBeInTheDocument();
        expect(screen.getByLabelText('Report link')).toHaveValue(`https://thgservices.io/website-checker/?r=${TOKEN}`);
      });
    });
  });
});
