// Visitor-facing strings the Worker returns itself. The first group is word for word
// the same as vite-app/src/components/concierge/copy.ts (contract section 2.7); the
// second group is the exact wording the system prompt requires for fixed replies.

// Shared with the front end.
export const RATE_LIMITED = "Let's keep going by phone — call (866) 519-7993.";
export const LEAD_ONLY =
  'Our chat helper is taking a short break. Leave your info and someone from our team will call you back.';
export const ENDED =
  "I'm going to step out of this chat. If you'd like to talk with the team, call (866) 519-7993.";
export const TOO_LONG = 'That message is a bit long for me — could you keep it under 1,000 characters?';
export const HANDOFF = 'You got it — call (866) 519-7993 to reach a person on our team.';

// Fixed replies from system-prompt.md rules 1 and 2, used when a guard answers without the model.
export const OFF_TOPIC_REPLY =
  "I'm just here to help with questions about THG AI Services — happy to set up a call if you'd like.";
export const PRICING_REPLY =
  'Pricing depends on your business — the team will walk you through it on a quick call.';

// Returned when the model refuses, runs out of tokens, or returns something unparseable.
export const FALLBACK_REPLY =
  "I'm not sure about that one. Want me to have someone from the team call you?";

/** Callback window labels, as shown to visitors and in the lead email. */
export const WINDOW_LABELS = {
  morning_9_11: 'Weekday morning (9–11 AM ET)',
  midday_11_1: 'Midday (11 AM–1 PM ET)',
  afternoon_1_3: 'Afternoon (1–3 PM ET)',
  late_afternoon_3_5: 'Late afternoon (3–5 PM ET)',
} as const;
