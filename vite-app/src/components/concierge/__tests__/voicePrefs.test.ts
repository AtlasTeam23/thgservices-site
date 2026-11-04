import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAP_MAX_AGE_MS,
  capExpired,
  loadVoicePrefs,
  saveVoicePrefs,
  spokenCapInForce,
  VOICE_PREFS_KEY,
  type VoicePrefs,
} from '../voice/prefs';

const capped = (at: number | null, extra: Partial<VoicePrefs> = {}): VoicePrefs => ({
  speak: true,
  disclosed: true,
  blocked: false,
  spokenLimit: true,
  spokenLimitAt: at,
  bonusOffer: true,
  bonusCount: null,
  bonusUsed: false,
  soundHint: true,
  greeted: false,
  ...extra,
});

const at = (iso: string) => new Date(iso).getTime();

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the persisted cap on spoken replies expires', () => {
  const noon = at('2026-11-04T12:00:00');

  it('lasts 60 minutes', () => {
    expect(CAP_MAX_AGE_MS).toBe(60 * 60 * 1000);
    expect(capExpired(capped(noon), noon)).toBe(false);
    expect(capExpired(capped(noon), noon + CAP_MAX_AGE_MS)).toBe(false); // exactly an hour: not older than an hour
    expect(capExpired(capped(noon), noon + CAP_MAX_AGE_MS + 1)).toBe(true);
  });

  it('ends at local midnight, however recent it was', () => {
    const lateNight = at('2026-11-04T23:59:00');
    const justAfter = at('2026-11-05T00:01:00'); // two minutes later, a new day
    expect(capExpired(capped(lateNight), lateNight + 30_000)).toBe(false); // 23:59:30, same day
    expect(capExpired(capped(lateNight), justAfter)).toBe(true);
  });

  it('a cap with no timestamp (written before there was one) is treated as expired', () => {
    expect(capExpired(capped(null), noon)).toBe(true);
  });

  it('no cap, nothing to expire', () => {
    expect(capExpired(capped(noon, { spokenLimit: false }), noon + 10 * CAP_MAX_AGE_MS)).toBe(false);
  });

  it('is stored with the time it was set', () => {
    saveVoicePrefs(capped(noon));
    expect(JSON.parse(window.sessionStorage.getItem(VOICE_PREFS_KEY)!)).toMatchObject({
      spokenLimit: true,
      spokenLimitAt: noon,
    });
  });

  it('loading a fresh cap keeps it, with its offer', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(noon + 59 * 60_000);
    saveVoicePrefs(capped(noon));
    expect(loadVoicePrefs()).toMatchObject({ spokenLimit: true, spokenLimitAt: noon, bonusOffer: true });
  });

  it('loading a cap older than an hour clears it and the offer, and keeps everything else', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(noon + 61 * 60_000);
    saveVoicePrefs(capped(noon, { bonusUsed: true }));
    const prefs = loadVoicePrefs();
    expect(prefs.spokenLimit).toBe(false);
    expect(prefs.spokenLimitAt).toBeNull();
    expect(prefs.bonusOffer).toBe(false);
    expect(prefs).toMatchObject({ speak: true, disclosed: true, bonusUsed: true, soundHint: true });
  });

  it('loading a cap from yesterday clears it even if it is only minutes old', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    saveVoicePrefs(capped(at('2026-11-04T23:58:00')));
    vi.setSystemTime(at('2026-11-05T00:03:00'));
    expect(loadVoicePrefs().spokenLimit).toBe(false);
  });

  it('loading an old-format cap (no timestamp) clears it', () => {
    window.sessionStorage.setItem(
      VOICE_PREFS_KEY,
      JSON.stringify({ speak: true, disclosed: true, spokenLimit: true, bonusOffer: true })
    );
    const prefs = loadVoicePrefs();
    expect(prefs.spokenLimit).toBe(false);
    expect(prefs.bonusOffer).toBe(false);
  });
});

describe('spokenCapInForce (the pure test the controller and the greeting share)', () => {
  const noon = at('2026-11-04T12:00:00');

  it('is false without a cap, true for a fresh one, false once it has lapsed', () => {
    expect(spokenCapInForce(capped(noon, { spokenLimit: false }), noon)).toBe(false);
    expect(spokenCapInForce(capped(noon), noon + 5 * 60_000)).toBe(true);
    expect(spokenCapInForce(capped(noon), noon + CAP_MAX_AGE_MS)).toBe(true);
    expect(spokenCapInForce(capped(noon), noon + CAP_MAX_AGE_MS + 1)).toBe(false);
    expect(spokenCapInForce(capped(at('2026-11-04T23:59:00')), at('2026-11-05T00:01:00'))).toBe(false);
  });

  it('treats a cap with no timestamp as lapsed, and changes nothing it is given', () => {
    const prefs = capped(null);
    expect(spokenCapInForce(prefs, noon)).toBe(false);
    expect(prefs.spokenLimit).toBe(true);
  });
});

describe('the greeted flag', () => {
  it('is false for a visitor with nothing stored, and for stored prefs from before it existed', () => {
    expect(loadVoicePrefs().greeted).toBe(false);
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: true, disclosed: true }));
    expect(loadVoicePrefs().greeted).toBe(false);
  });

  it('is kept like the other flags, and only written when set', () => {
    saveVoicePrefs({ ...capped(null), spokenLimit: false, bonusOffer: false, soundHint: false, greeted: true });
    expect(JSON.parse(window.sessionStorage.getItem(VOICE_PREFS_KEY)!)).toEqual({ speak: true, disclosed: true, greeted: true });
    expect(loadVoicePrefs().greeted).toBe(true);

    saveVoicePrefs({ ...capped(null), spokenLimit: false, bonusOffer: false, soundHint: false });
    expect(JSON.parse(window.sessionStorage.getItem(VOICE_PREFS_KEY)!)).toEqual({ speak: true, disclosed: true });
  });

  it('survives the cap lapsing on load', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const noon = at('2026-11-04T12:00:00');
    vi.setSystemTime(noon + 2 * CAP_MAX_AGE_MS);
    saveVoicePrefs(capped(noon, { greeted: true }));
    expect(loadVoicePrefs()).toMatchObject({ spokenLimit: false, greeted: true });
  });

  it('only counts a real true', () => {
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ greeted: 'yes' }));
    expect(loadVoicePrefs().greeted).toBe(false);
  });
});
