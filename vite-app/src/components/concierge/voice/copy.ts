// Visitor-facing strings for spoken replies (and the greeting).
//
// These live next to the voice code rather than in ../copy.ts: that module is
// shared with the always-loaded bubble, so anything added there lands in the main
// bundle. This file is only imported from the lazy panel chunk.

/** The header toggle's name. Fixed: its state is announced once, by aria-pressed. It is the word the touch label starts with ("Sound on" / "Sound off"), so voice control can say what it sees (WCAG 2.5.3). */
export const VOICE_SPEAK_TOGGLE = 'Sound';
/** Its tooltip. */
export const VOICE_SPEAK_TOGGLE_TITLE = 'Read replies aloud';
export const VOICE_STOP_SPEAKING = 'Stop reading aloud';
/** Shown once, under the composer, from the first time replies are read aloud. */
export const VOICE_DISCLOSURE = 'Replies are read aloud. Use the speaker button to turn sound off.';

/** The header speaker toggle's visible label on touch screens (icon-only elsewhere). */
export const VOICE_SOUND_ON = 'Sound on';
export const VOICE_SOUND_OFF = 'Sound off';

/** Under a reply whose audio the browser would not start: a tap plays it. */
export const VOICE_TAP_TO_HEAR = 'Tap to hear replies';
/** Shown once, under the composer, the first time that happens. */
export const VOICE_SOUND_OFF_HINT = 'Sound is off until you tap.';

/** The visitor's daily allowance of spoken replies is used up, and nothing more is on offer. */
export const VOICE_SPOKEN_LIMIT_DONE = 'Read-aloud is done for today. You can keep chatting here.';
/** How many spoken replies a bonus adds when the Worker does not say. */
export const DEFAULT_BONUS_REPLIES = 5;

/** The number to put in the wording: the Worker's, if it is a sensible whole number, else 5. */
const bonusReplies = (n?: number | null): number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 100 ? n : DEFAULT_BONUS_REPLIES;

/** ...and sharing contact details would add more. */
export const voiceSpokenLimitBonus = (n?: number | null) =>
  `Read-aloud is paused. Share your name, email and number and we'll add ${bonusReplies(n)} more today.`;
/** The chip next to that notice: opens the lead form. */
export const VOICE_SHARE_DETAILS = 'Share my details';
/** The line above the lead form when it was opened from that chip. */
export const voiceBonusFormHeading = (n?: number | null) => {
  const count = bonusReplies(n);
  return `Add your email and we'll add ${count} more spoken ${count === 1 ? 'reply' : 'replies'} today.`;
};
/** The email field's error when the form was opened for the bonus and it is empty. */
export const VOICE_EMAIL_FOR_BONUS = 'Enter your email so we can add your replies';
