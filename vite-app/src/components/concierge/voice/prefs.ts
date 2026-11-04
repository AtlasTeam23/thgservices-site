// Voice preferences for this tab (voice plan section 1.4). A few flags only, in
// sessionStorage like the chat itself, so they end with the tab. No audio and no
// text is ever kept here. Every access is wrapped: the widget must work with
// storage disabled.

export const VOICE_PREFS_KEY = 'thg-concierge-voice-v1';

export type VoicePrefs = {
  /** Read replies aloud. Null until the visitor (or their first voice use) decides. */
  speak: boolean | null;
  /** The first voice use has happened: the microphone line is not shown again this tab session. */
  disclosed: boolean;
  /** The day's voice budget is spent: no mic for the rest of this tab session. */
  blocked: boolean;
  /** The day's spoken-reply allowance is used up: no audio is requested while this holds. */
  spokenLimit: boolean;
  /** When the cap was seen (epoch ms); it lapses after an hour or at local midnight. */
  spokenLimitAt: number | null;
  /** ...and the Worker said sharing contact details would add more (the offer is still open). */
  bonusOffer: boolean;
  /** How many replies the offer adds, if the Worker said (otherwise the default is used). */
  bonusCount: number | null;
  /** The details were shared and the bonus granted; it is not offered a second time. */
  bonusUsed: boolean;
  /** "Sound is off until you tap." has been shown. */
  soundHint: boolean;
  /** The recorded opening greeting has been started this tab session: it plays once, not on every open. */
  greeted: boolean;
};

const NONE: VoicePrefs = {
  speak: null,
  disclosed: false,
  blocked: false,
  spokenLimit: false,
  spokenLimitAt: null,
  bonusOffer: false,
  bonusCount: null,
  bonusUsed: false,
  soundHint: false,
  greeted: false,
};

/** How long a cap is believed: the Worker's allowance is per day, but a visitor may have been granted more. */
export const CAP_MAX_AGE_MS = 60 * 60 * 1000;

/** The cap has lapsed: older than an hour, from an earlier local calendar day, or of unknown age. */
export function capExpired(prefs: VoicePrefs, now: number): boolean {
  if (!prefs.spokenLimit) return false;
  const at = prefs.spokenLimitAt;
  if (at === null) return true;
  return now - at > CAP_MAX_AGE_MS || new Date(at).toDateString() !== new Date(now).toDateString();
}

/**
 * The day's allowance of spoken replies is used up, and the cap has not lapsed: no audio is requested while this
 * holds. Pure; the voice controller (which also drops a lapsed cap) and the greeting both ask it.
 */
export const spokenCapInForce = (prefs: VoicePrefs, now: number): boolean =>
  prefs.spokenLimit && !capExpired(prefs, now);

/** The same prefs with the cap (and the offer that went with it) cleared. */
export const withoutCap = (prefs: VoicePrefs): VoicePrefs => ({
  ...prefs,
  spokenLimit: false,
  spokenLimitAt: null,
  bonusOffer: false,
  bonusCount: null,
});

export function loadVoicePrefs(now: number = Date.now()): VoicePrefs {
  const prefs = readVoicePrefs();
  // A cap that has lapsed is dropped on load, so a returning visitor's replies are read again.
  return capExpired(prefs, now) ? withoutCap(prefs) : prefs;
}

function readVoicePrefs(): VoicePrefs {
  try {
    const raw = window.sessionStorage.getItem(VOICE_PREFS_KEY);
    if (!raw) return { ...NONE };
    const parsed: unknown = JSON.parse(raw);
    const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    return {
      speak: typeof o.speak === 'boolean' ? o.speak : null,
      disclosed: o.disclosed === true,
      blocked: o.blocked === true,
      spokenLimit: o.spokenLimit === true,
      spokenLimitAt:
        typeof o.spokenLimitAt === 'number' && Number.isFinite(o.spokenLimitAt) ? o.spokenLimitAt : null,
      bonusOffer: o.bonusOffer === true,
      bonusCount: typeof o.bonusCount === 'number' && Number.isInteger(o.bonusCount) ? o.bonusCount : null,
      bonusUsed: o.bonusUsed === true,
      soundHint: o.soundHint === true,
      greeted: o.greeted === true,
    };
  } catch {
    return { ...NONE };
  }
}

export function saveVoicePrefs(prefs: VoicePrefs): void {
  try {
    window.sessionStorage.setItem(
      VOICE_PREFS_KEY,
      JSON.stringify({
        speak: prefs.speak,
        disclosed: prefs.disclosed,
        // Only written when set, so the stored shape stays two flags for everyone else.
        ...(prefs.blocked ? { blocked: true } : {}),
        ...(prefs.spokenLimit ? { spokenLimit: true, spokenLimitAt: prefs.spokenLimitAt } : {}),
        ...(prefs.bonusOffer ? { bonusOffer: true } : {}),
        ...(prefs.bonusOffer && prefs.bonusCount !== null ? { bonusCount: prefs.bonusCount } : {}),
        ...(prefs.bonusUsed ? { bonusUsed: true } : {}),
        ...(prefs.soundHint ? { soundHint: true } : {}),
        ...(prefs.greeted ? { greeted: true } : {}),
      })
    );
  } catch {
    // storage disabled or full; the in-memory choice still works
  }
}
