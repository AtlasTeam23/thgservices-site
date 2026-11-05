// Visitor-facing text for the website checker page. Failure messages and the
// read-limited banner are word for word from the spec.

import { SITE_QUICK_REPLIES } from '../../components/concierge/copy';
import type { FailReason } from './types';

export const START_HEADING = 'Free website checker';
export const START_SUB =
  'See how easy your website is to find, and how well it turns visitors into customers.';
export const WEBSITE_LABEL = 'Your website';
export const WEBSITE_PLACEHOLDER = 'yourcompany.com';
export const INDUSTRY_LABEL = 'Your industry';
export const INDUSTRY_PLACEHOLDER = 'Choose your industry';
export const INDUSTRY_REQUIRED = 'Choose the closest industry.';
export const CITY_LABEL = 'City or ZIP (optional)';
export const CITY_HELP = 'Used for competitor comparison.';
export const CHECK_BUTTON = 'Check my website';
export const START_SMALL_PRINT =
  'Free. No account needed. We read your home page the way a search engine does.';

export const CHECKING_TEXT = 'Checking your home page. This usually takes a few seconds.';

export const OVERALL_LABEL = 'Overall';
export const SEO_LABEL = 'SEO';
export const SEO_SUB = 'How easy you are to find in search.';
export const CONVERSION_LABEL = 'Conversion';
export const CONVERSION_SUB = 'How well your site turns visitors into leads.';
export const CHECK_AGAIN = 'Check again';

export const READ_LIMITED_BANNER =
  "We could only read part of this site. Your home page sends almost no text until JavaScript runs, so we can't grade how it turns visitors into leads. Search engines and AI tools can have the same trouble.";

export const COUNTS_LINE = (fix: number, improve: number, passing: number) =>
  `${fix} to fix, ${improve} to improve, ${passing} passing.`;

export const CHECKED_AGO = (when: string) => `Checked ${when}.`;

export const COMPARE_HEADING = 'Compare with competitors';
export const COMPARE_TEXT = 'Add up to three competitor websites to see their grades next to yours.';
export const COMPETITOR_LABEL = (n: number) => `Competitor ${n} website`;
export const ADD_COMPETITOR = 'Add another';
export const COMPARE_BUTTON = 'Compare';
export const REMOVE_COMPETITOR = (n: number) => `Remove competitor ${n}`;
export const YOUR_SITE = 'Your site';

export const UNLOCK_HEADING = 'Get your full breakdown, free';
export const UNLOCK_TEXT = 'Every check, what we found, and how to fix it.';
export const NAME_LABEL = 'Name';
export const EMAIL_LABEL = 'Email';
export const PHONE_LABEL = 'Phone';
export const OK_TO_CALL = 'OK to call or text me about my results';
export const SHOW_BREAKDOWN = 'Show my breakdown';
export const UNLOCK_SMALL_PRINT =
  "We'll email you a copy and may follow up by email about your results.";
export const PRIVACY_LINK_TEXT = 'Privacy policy';
export const PRIVACY_HREF = '/privacy.html#website-checker';
export const NAME_ERROR = 'Enter your name.';
export const EMAIL_ERROR = 'Enter a valid email address.';
export const PHONE_ERROR = 'Enter a 10-digit phone number.';
export const OPTIONAL_EMAIL_LABEL = 'Email me a copy';
export const OPTIONAL_EMAIL_BUTTON = 'Send';
export const EMAILED_TO = (email: string) => `We emailed a copy to ${email}.`;
export const EMAIL_NOT_SENT =
  "We couldn't email a copy just now. Use Copy link to this report to keep it.";

export const PLAN_HEADING = 'Your action plan';
export const FIX_FIRST_HEADING = 'Fix these first';
export const COMPARISON_HEADING = 'How you compare';
export const COMPARISON_GAP_NOTE = 'Rows in color are checks a competitor passes and you do not.';
export const STATUS_LABEL = { pass: 'Pass', warn: 'Needs work', fail: 'Fail' } as const;
export const GET_HELP = 'Get help fixing this';
export const COPY_LINK = 'Copy link to this report';
export const LINK_COPIED = 'Link copied';
export const BREAKDOWN_FOOTER =
  "This is an automated check of your home page's public code. It doesn't measure real load time or guarantee search rankings.";
export const REPORT_FOR = (host: string) => `Report for ${host}`;
export const LOADING_REPORT = 'Opening your report.';
export const REPORT_NOT_FOUND =
  "We couldn't find that report. The link may be incomplete or out of date.";
export const CHECK_A_SITE = 'Check a website';
export const TRY_ANOTHER = 'Try another website';
export const ASK_A_PERSON = 'Ask a person to look';

// Must stay in step with SITE_QUICK_REPLIES in components/concierge/copy.ts:
// the chat runs only the quick replies it knows.
export const HELP_QUICK_REPLY = SITE_QUICK_REPLIES[0];
export const PERSON_QUICK_REPLY = SITE_QUICK_REPLIES[1];

export const FAILURE: Record<FailReason, (host: string) => string> = {
  blocked: () =>
    "This site blocks automated checks, so we can't grade it. That's common with security settings and doesn't mean anything is wrong.",
  no_response: (host) =>
    `We couldn't reach ${host}. Check the spelling and make sure the site is live.`,
  not_found: (host) => `${host} answered, but we couldn't find its home page.`,
  site_error: (host) => `${host} returned an error when we asked for its home page. Try again.`,
  timeout: (host) => `${host} took too long to answer. Try again.`,
  not_html: () => "That address doesn't open a web page.",
  too_large: () =>
    'This home page is over 3 MB, which is too big for us to read. A page that size is slow to open on phones too.',
  invalid_url: () => 'Enter a website address like yourcompany.com.',
  recheck_too_soon: () => 'We just checked this site. Try again in a few minutes.',
};

export const RATE_LIMITED = "You've run several checks in a row. Try again in a few minutes.";
export const DAILY_CAP = "We've run a lot of checks today. Try again tomorrow.";
export const EXPIRED = 'That check has expired. Run the check again.';
export const BAD_REQUEST = 'Something was off with that request. Run the check again.';
export const ALREADY_SENT = 'We already sent a copy to that address today.';
export const COPY_FAILED = "Couldn't copy, select the link instead.";
export const OWN_SITE = 'That is your own website. Enter a competitor.';
export const NOT_READY = "The checker isn't available right now. Please try again later.";
export const NETWORK_ERROR = 'Something went wrong on our end. Please try again in a moment.';
export const VERIFY_ERROR = "We couldn't verify your browser. Reload the page and try again.";
