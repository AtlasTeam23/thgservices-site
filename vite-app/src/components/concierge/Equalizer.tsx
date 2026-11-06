import { useMediaQuery } from './useMediaQuery';
import { VOICE_STOP_SPEAKING } from './voice/copy';

type Props = {
  /** A tap on the bars stops the reading. */
  onStop: () => void;
};

const BARS = [0, 1, 2, 3, 4];

/**
 * The hero's equalizer, small, in the panel header, shown while a reply (or the greeting) is read
 * aloud: the hero's looping animation, and the whole thing is a button that stops the reading.
 * With reduced motion the bars stand still.
 */
export default function Equalizer({ onStop }: Props) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  return (
    <button
      type="button"
      className="thg-cc-eq thg-cc-eq--button"
      aria-label={VOICE_STOP_SPEAKING}
      title={VOICE_STOP_SPEAKING}
      onClick={onStop}
      data-mode="speaking"
      data-motion={reduced ? 'reduced' : undefined}
    >
      {BARS.map((n) => (
        <i key={n} />
      ))}
    </button>
  );
}
