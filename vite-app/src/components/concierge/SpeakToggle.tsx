import { VOICE_SOUND_OFF, VOICE_SOUND_ON, VOICE_SPEAK_TOGGLE } from './voice/copy';

type Props = {
  pressed: boolean;
  onToggle: () => void;
  /** Touch screens: say "Sound on" / "Sound off" in words next to the icon. */
  showLabel?: boolean;
};

/** "Read replies aloud" in the panel header. */
export default function SpeakToggle({ pressed, onToggle, showLabel = false }: Props) {
  const state = pressed ? VOICE_SOUND_ON : VOICE_SOUND_OFF;
  // The visible words are part of the name (WCAG 2.5.3); the name still says what the button is for.
  const name = showLabel ? `${state}, ${VOICE_SPEAK_TOGGLE.toLowerCase()}` : VOICE_SPEAK_TOGGLE;
  return (
    <button
      type="button"
      className={`thg-cc-speak${showLabel ? ' thg-cc-speak--labelled' : ''}`}
      aria-pressed={pressed}
      aria-label={name}
      title={VOICE_SPEAK_TOGGLE}
      onClick={onToggle}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        {pressed ? (
          <>
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
          </>
        ) : (
          <>
            <path d="m16 9 5 6" />
            <path d="m21 9-5 6" />
          </>
        )}
      </svg>
      {showLabel && (
        <span className="thg-cc-speak-label" aria-hidden="true">
          {state}
        </span>
      )}
    </button>
  );
}
