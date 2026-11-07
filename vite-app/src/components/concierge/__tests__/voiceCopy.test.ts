import { describe, expect, it } from 'vitest';
import * as copy from '../voice/copy';

// The voice strings live beside the voice code (not in copy.ts) so that nothing
// voice-related is pulled into the always-loaded main bundle.
describe('voice copy', () => {
  it('has the strings for the speaker toggle and the read-aloud line', () => {
    expect(copy.VOICE_SPEAK_TOGGLE).toBe('Sound');
    expect(copy.VOICE_SPEAK_TOGGLE_TITLE).toBe('Read replies aloud');
    expect(copy.VOICE_STOP_SPEAKING).toBe('Stop reading aloud');
    expect(copy.VOICE_DISCLOSURE).toBe('Replies are read aloud. Use the speaker button to turn sound off.');
  });

  it('has nothing left over from voice input', () => {
    for (const key of [
      'VOICE_BUTTON',
      'VOICE_BUTTON_DESKTOP',
      'VOICE_STOP',
      'VOICE_LISTENING',
      'VOICE_TRANSCRIBING',
      'VOICE_HEARD_NOTHING',
      'VOICE_OFF',
      'VOICE_DENIED',
      'VOICE_NO_MIC',
      'VOICE_ERROR',
      'VOICE_HOLD_HINT',
      'VOICE_ENDING_SOON',
    ]) {
      expect(key in copy, key).toBe(false);
    }
    for (const [key, value] of Object.entries(copy)) {
      if (typeof value === 'function') continue;
      expect(String(value), key).not.toMatch(/microphone|hold to talk|click to talk|recording|transcrib/i);
    }
  });

  it('has the strings for the sound toggle, the tap-to-hear pill and the cap on spoken replies', () => {
    expect(copy.VOICE_SOUND_ON).toBe('Sound on');
    expect(copy.VOICE_SOUND_OFF).toBe('Sound off');
    expect(copy.VOICE_TAP_TO_HEAR).toBe('Tap to hear replies');
    expect(copy.VOICE_SOUND_OFF_HINT).toBe('Sound is off until you tap.');
    expect(copy.VOICE_SPOKEN_LIMIT_DONE).toBe(
      'Read-aloud is done for today. You can keep chatting here.'
    );
    expect(copy.voiceSpokenLimitBonus(5)).toBe(
      "Read-aloud is paused. Share your name, email and number and we'll add 5 more today."
    );
    expect(copy.VOICE_SHARE_DETAILS).toBe('Share my details');
    expect(copy.voiceBonusFormHeading(5)).toBe("Add your email and we'll add 5 more spoken replies today.");
    expect(copy.VOICE_EMAIL_FOR_BONUS).toBe('Enter your email so we can add your replies');
  });

  describe('the bonus wording uses the number the Worker gives, and 5 when it gives none', () => {
    it('defaults to 5', () => {
      expect(copy.DEFAULT_BONUS_REPLIES).toBe(5);
      expect(copy.voiceSpokenLimitBonus()).toBe(copy.voiceSpokenLimitBonus(5));
      expect(copy.voiceBonusFormHeading(undefined)).toBe(copy.voiceBonusFormHeading(5));
      expect(copy.voiceSpokenLimitBonus(null)).toContain('add 5 more today');
    });

    it('uses a number it is given', () => {
      expect(copy.voiceSpokenLimitBonus(10)).toBe(
        "Read-aloud is paused. Share your name, email and number and we'll add 10 more today."
      );
      expect(copy.voiceBonusFormHeading(10)).toBe(
        "Add your email and we'll add 10 more spoken replies today."
      );
    });

    it('says "reply" for one', () => {
      expect(copy.voiceBonusFormHeading(1)).toBe("Add your email and we'll add 1 more spoken reply today.");
      expect(copy.voiceSpokenLimitBonus(1)).toContain('add 1 more today');
    });

    it('falls back to 5 for anything that is not a sensible whole number', () => {
      for (const bad of [0, -2, 2.5, Number.NaN, Infinity, 1000]) {
        expect(copy.voiceSpokenLimitBonus(bad), String(bad)).toContain('add 5 more today');
        expect(copy.voiceBonusFormHeading(bad), String(bad)).toContain('add 5 more spoken replies');
      }
    });
  });

  it('names no speech provider anywhere in what a visitor can read', () => {
    for (const [key, value] of Object.entries(copy)) {
      if (typeof value === 'function') continue;
      expect(String(value), key).not.toMatch(/aura|eleven|deepgram|cloudflare|whisper|openai|google/i);
    }
  });

  it('does not add anything voice-related to the always-loaded copy module', async () => {
    const main = await import('../copy');
    expect(Object.keys(main).filter((k) => k.startsWith('VOICE_'))).toEqual([]);
  });
});
