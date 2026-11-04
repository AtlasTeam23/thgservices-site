// The two things about the stored voice preferences that the always-loaded bubble needs: where they are
// kept, and whether the daily cap on spoken replies is in force. Everything else about them (reading and
// writing the whole set) is in prefs.ts, in the panel chunk, which re-exports these.

/** sessionStorage key of the voice preferences (see prefs.ts for what is kept there). */
export const VOICE_PREFS_KEY = 'thg-concierge-voice-v1';

/** The part of the preferences that describes the cap. */
export type SpokenCap = {
  /** The day's spoken-reply allowance is used up: no audio is requested while this holds. */
  spokenLimit: boolean;
  /** When the cap was seen (epoch ms); it lapses after an hour or at local midnight. */
  spokenLimitAt: number | null;
};

/** How long a cap is believed: the Worker's allowance is per day, but a visitor may have been granted more. */
export const CAP_MAX_AGE_MS = 60 * 60 * 1000;

/** The cap has lapsed: older than an hour, from an earlier local calendar day, or of unknown age. */
export function capExpired(prefs: SpokenCap, now: number): boolean {
  if (!prefs.spokenLimit) return false;
  const at = prefs.spokenLimitAt;
  if (at === null) return true;
  return now - at > CAP_MAX_AGE_MS || new Date(at).toDateString() !== new Date(now).toDateString();
}

/**
 * The day's allowance of spoken replies is used up, and the cap has not lapsed: no audio is requested while this
 * holds. Pure; the voice controller (which also drops a lapsed cap) and the greeting both ask it.
 */
export const spokenCapInForce = (prefs: SpokenCap, now: number): boolean =>
  prefs.spokenLimit && !capExpired(prefs, now);
