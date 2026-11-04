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
  /** The day's spoken-reply allowance is used up: no more audio is requested this tab session. */
  spokenLimit: boolean;
  /** ...and the Worker said sharing contact details would add more (the offer is still open). */
  bonusOffer: boolean;
  /** The details were shared and the bonus granted; it is not offered a second time. */
  bonusUsed: boolean;
  /** "Sound is off until you tap." has been shown. */
  soundHint: boolean;
};

const NONE: VoicePrefs = {
  speak: null,
  disclosed: false,
  blocked: false,
  spokenLimit: false,
  bonusOffer: false,
  bonusUsed: false,
  soundHint: false,
};

export function loadVoicePrefs(): VoicePrefs {
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
      bonusOffer: o.bonusOffer === true,
      bonusUsed: o.bonusUsed === true,
      soundHint: o.soundHint === true,
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
        ...(prefs.spokenLimit ? { spokenLimit: true } : {}),
        ...(prefs.bonusOffer ? { bonusOffer: true } : {}),
        ...(prefs.bonusUsed ? { bonusUsed: true } : {}),
        ...(prefs.soundHint ? { soundHint: true } : {}),
      })
    );
  } catch {
    // storage disabled or full; the in-memory choice still works
  }
}
