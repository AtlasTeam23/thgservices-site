import { describe, expect, it } from 'vitest';
import * as copy from '../voice/copy';

// The voice strings live beside the voice code (not in copy.ts) so that nothing
// voice-related is pulled into the always-loaded main bundle.
describe('voice copy (plan section 1.4)', () => {
  it('has the exact strings from the plan', () => {
    expect(copy.VOICE_BUTTON).toBe('Hold to talk');
    expect(copy.VOICE_BUTTON_DESKTOP).toBe('Click to talk');
    expect(copy.VOICE_STOP).toBe('Stop');
    expect(copy.VOICE_LISTENING).toBe('Listening…');
    expect(copy.VOICE_HEARD_NOTHING).toBe(
      "I didn't catch that. Try again or type your question."
    );
    expect(copy.VOICE_OFF).toBe('Voice is taking a break today. You can still type.');
    expect(copy.VOICE_SPEAK_TOGGLE).toBe('Read replies aloud');
    expect(copy.VOICE_DISCLOSURE).toBe(
      "Voice uses your microphone only while you're recording. Audio isn't stored."
    );
  });

  it('has the supporting strings the widget needs beyond the plan table', () => {
    expect(copy.VOICE_TRANSCRIBING).toBe('Transcribing…');
    expect(copy.VOICE_DENIED).toBe(
      'Microphone access is blocked. Allow it in your browser settings, or type your question.'
    );
    expect(copy.VOICE_NO_MIC).toBe(
      "I couldn't use your microphone. You can still type your question."
    );
    expect(copy.VOICE_ERROR).toBe(
      "Voice didn't work that time. Try again or type your question."
    );
    expect(copy.VOICE_HOLD_HINT).toBe('Hold the button while you talk.');
    expect(copy.VOICE_STOP_SPEAKING).toBe('Stop reading aloud');
    expect(copy.VOICE_ENDING_SOON).toBe('Ending soon');
    expect('VOICE_SECONDS_LEFT' in copy).toBe(false);
  });

  it('does not add anything voice-related to the always-loaded copy module', async () => {
    const main = await import('../copy');
    expect(Object.keys(main).filter((k) => k.startsWith('VOICE_'))).toEqual([]);
  });
});
