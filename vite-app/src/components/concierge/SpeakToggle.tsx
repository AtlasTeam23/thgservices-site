import { VOICE_SPEAK_TOGGLE } from './voice/copy';

type Props = {
  pressed: boolean;
  onToggle: () => void;
};

/** "Read replies aloud" in the panel header. */
export default function SpeakToggle({ pressed, onToggle }: Props) {
  return (
    <button
      type="button"
      className="thg-cc-speak"
      aria-pressed={pressed}
      aria-label={VOICE_SPEAK_TOGGLE}
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
    </button>
  );
}
