import { useCallback, useEffect, useRef } from 'react';
import { useMediaQuery } from './useMediaQuery';
import { VOICE_STOP_SPEAKING } from './voice/copy';

type Props = {
  mode: 'listening' | 'transcribing' | 'speaking';
  /** Input level, 0 to 1, about 20 times a second while listening. */
  subscribeLevel: (listener: (level: number) => void) => () => void;
  /** Speaking only: a tap on the bars stops the reading. */
  onStop?: () => void;
};

const BARS = [0, 1, 2, 3, 4];

/**
 * The hero's equalizer, small, in the panel header. While listening the bars follow the
 * microphone level (written straight to a CSS variable, so React does not re-render 20
 * times a second); while a reply is read aloud they play the hero's looping animation,
 * and the whole thing is a button that stops the reading. With reduced motion the bars
 * stand still in every mode.
 */
export default function Equalizer({ mode, subscribeLevel, onStop }: Props) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  // The bars are a <div> while listening and a <button> while speaking; either way it is just an element.
  const elRef = useRef<HTMLElement | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (mode !== 'listening' || reduced || !el) return;
    const off = subscribeLevel((level) => {
      el.style.setProperty('--thg-cc-level', String(Math.round(level * 100) / 100));
    });
    return () => {
      off();
      el.style.removeProperty('--thg-cc-level');
    };
  }, [mode, reduced, subscribeLevel]);

  const bars = BARS.map((n) => <i key={n} />);
  const common = {
    'data-mode': mode === 'transcribing' ? 'working' : mode,
    'data-motion': reduced ? 'reduced' : undefined,
  };

  if (mode === 'speaking') {
    return (
      <button
        ref={ref}
        type="button"
        className="thg-cc-eq thg-cc-eq--button"
        aria-label={VOICE_STOP_SPEAKING}
        title={VOICE_STOP_SPEAKING}
        onClick={onStop}
        {...common}
      >
        {bars}
      </button>
    );
  }
  return (
    <div ref={ref} className="thg-cc-eq" aria-hidden="true" {...common}>
      {bars}
    </div>
  );
}
