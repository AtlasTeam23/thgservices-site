// All visitor-facing strings for the chat widget (plan section 2.7).
// The Worker reuses RATE_LIMITED, LEAD_ONLY, ENDED and TOO_LONG word for word.

import type { CallbackWindow } from './types';

export const PHONE_DISPLAY = '(866) 519-7993';
export const PHONE_HREF = 'tel:+18665197993';
export const PRIVACY_HREF = '/privacy.html#ai-chat';

export const BUBBLE_LABEL = 'Questions? Chat with us';
export const PANEL_TITLE = 'THG AI Concierge Agent';
export const DISCLOSURE =
  "You're chatting with an AI assistant. Don't share sensitive info.";
export const GREETING =
  "Hi there! I'm the THG AI Concierge Agent. I can answer questions about how we help local businesses save time with AI, or set up a quick call with David's team. What can I help with?";

export const CHIPS = [
  'What do you do?',
  'Try the AI Concierge',
  'Request a callback',
] as const;
export const OFFER_CHIPS = ['Yes, call me', 'No thanks'] as const;

/** Every chip label the widget can show; anything else is not a quick reply. */
export const isKnownChip = (label: string): boolean =>
  (CHIPS as readonly string[]).includes(label) || (OFFER_CHIPS as readonly string[]).includes(label);

/** The chip that opens the lead form instead of sending text. */
export const CALLBACK_CHIP = 'Request a callback';
export const OFFER_YES = 'Yes, call me';
export const OFFER_NO = 'No thanks';

export const CALLBACK_INTRO =
  'Happy to set that up. Fill in a few details and someone from our team will reach out during the window you pick.';
export const HANDOFF = `You got it — call ${PHONE_DISPLAY} to reach a person on our team.`;

export const CONFIRM = (first: string, window: string) =>
  `Thanks, ${first}! Someone from our team will reach out during your ${window} window. If it's urgent, call ${PHONE_DISPLAY}.`;

export const RATE_LIMITED = `Let's keep going by phone — call ${PHONE_DISPLAY}.`;
export const LEAD_ONLY =
  'Our chat helper is taking a short break. Leave your info and someone from our team will call you back.';
export const ENDED = `I'm going to step out of this chat. If you'd like to talk with the team, call ${PHONE_DISPLAY}.`;
export const ERROR = `Something hiccuped on our end. You can try again, or call ${PHONE_DISPLAY}.`;
export const DELIVERY_FAILED = `I couldn't send that just now. Please call ${PHONE_DISPLAY} and we'll take care of you.`;
export const TOO_LONG =
  'That message is a bit long for me — could you keep it under 1,000 characters?';

export const FOOTER_CALL = `Prefer to talk? Call ${PHONE_DISPLAY}`;
export const FOOTER_AI = 'AI assistant — may make mistakes.';
export const FOOTER_PRIVACY = 'Privacy';

/** One line above the lead form when the helper has gathered the details itself. */
export const LEAD_FORM_HEADING = "Here's what I have. Check the box and tap send.";

/** Under the form's submit button: close the form and carry on chatting. */
export const LEAD_FORM_DISMISS = 'Not now, keep chatting';

export const CONSENT = 'OK to contact me by phone, text, or email about my request.';

export const WINDOW_KEYS = [
  'morning_9_11',
  'midday_11_1',
  'afternoon_1_3',
  'late_afternoon_3_5',
] as const satisfies readonly CallbackWindow[];

export const WINDOWS: Record<CallbackWindow, string> = {
  morning_9_11: 'Weekday morning (9–11 AM ET)',
  midday_11_1: 'Midday (11 AM–1 PM ET)',
  afternoon_1_3: 'Afternoon (1–3 PM ET)',
  late_afternoon_3_5: 'Late afternoon (3–5 PM ET)',
};
