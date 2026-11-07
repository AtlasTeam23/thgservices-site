import type { Profile } from './types';

/**
 * The hidden launch shipped the page with no visible links to it. The public
 * launch flipped this one constant to true: the nav, the footer and the
 * "Website upgrades" item now show a link. Set it back to false to hide them.
 */
export const CHECKER_LINKS_LIVE = true;

export const CHECKER_PATH = '/website-checker/';
export const CHECKER_LINK_LABEL = 'Free website checker';

export const MAX_COMPETITORS = 3;
/** The browser gives up on a scan after this long. */
export const SCAN_TIMEOUT_MS = 35000;
/**
 * The Worker may spend up to 30 s on the grader and 20 s on the action plan
 * before it answers; the lead and the email are queued after the reply.
 */
export const UNLOCK_TIMEOUT_MS = 60000;

export const INDUSTRIES: readonly { value: Profile; label: string }[] = [
  {
    value: 'trade',
    label: 'Home services (flooring, plumbing, HVAC, roofing, landscaping, cleaning)',
  },
  {
    value: 'professional',
    label: 'Professional services (law, accounting, consulting, insurance, real estate)',
  },
  {
    value: 'health',
    label: 'Health and wellness (dental, medical, chiropractic, therapy, fitness, salon)',
  },
  { value: 'retail', label: 'Restaurants and retail' },
  { value: 'software', label: 'Software and online services' },
  { value: 'general', label: 'Other local business' },
];

export const industryLabel = (p: Profile): string => INDUSTRIES.find((i) => i.value === p)?.label ?? p;

export const isProfile = (v: string): v is Profile => INDUSTRIES.some((i) => i.value === v);
