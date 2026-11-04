// Visitor-facing strings for push-to-talk voice (plan section 1.4).
//
// These live next to the voice code rather than in ../copy.ts: that module is
// shared with the always-loaded bubble, so anything added there lands in the main
// bundle. This file is only imported from the lazy panel chunk.

/** Touch devices: press and hold. */
export const VOICE_BUTTON = 'Hold to talk';
/** Pointer devices: click to start, click again to stop. */
export const VOICE_BUTTON_DESKTOP = 'Click to talk';
export const VOICE_STOP = 'Stop';
export const VOICE_LISTENING = 'Listening…';
export const VOICE_TRANSCRIBING = 'Transcribing…';
export const VOICE_HEARD_NOTHING = "I didn't catch that. Try again or type your question.";
/** Daily budget spent, or the Worker could not do speech-to-text. */
export const VOICE_OFF = 'Voice is taking a break today. You can still type.';
export const VOICE_SPEAK_TOGGLE = 'Read replies aloud';
export const VOICE_STOP_SPEAKING = 'Stop reading aloud';
export const VOICE_DISCLOSURE =
  "Voice uses your microphone only while you're recording. Audio isn't stored.";

/** The browser (or the visitor) refused microphone access. */
export const VOICE_DENIED =
  'Microphone access is blocked. Allow it in your browser settings, or type your question.';
/** There is no usable microphone, or another app has it. */
export const VOICE_NO_MIC = "I couldn't use your microphone. You can still type your question.";
/** The transcript could not be fetched this time (network, server, bad audio). */
export const VOICE_ERROR = "Voice didn't work that time. Try again or type your question.";
/** A press-and-hold that was released at once. */
export const VOICE_HOLD_HINT = 'Hold the button while you talk.';

/** Text equivalent of the countdown ring in the last 5 seconds of a recording. */
export const VOICE_ENDING_SOON = 'Ending soon';
