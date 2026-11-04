import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { VoiceState } from './useConcierge';
import { VOICE_BUTTON, VOICE_BUTTON_DESKTOP, VOICE_STOP } from './voice/copy';
import { ENDING_WARNING_MS } from './voice/recorder';

type Props = {
  state: VoiceState;
  /** The last seconds of a recording: show the countdown ring. */
  ending: boolean;
  /** A touch screen: the label says "Hold to talk". */
  touch: boolean;
  /** A reply is pending. */
  busy: boolean;
  /** The chat has ended. */
  disabled: boolean;
  /** Id of the disclosure line, once it is showing. */
  describedBy?: string;
  /** `hold` is true when started by a touch press-and-hold. */
  onStart: (opts: { hold: boolean }) => void;
  onStop: () => void;
  /**
   * Called inside every gesture on the button, so iOS lets speech play later. A touch press is
   * not a user activation there; the release is, which is why that one counts too.
   */
  onUnlock: () => void;
};

/** A click that follows a touch release within this long is the browser's echo of it. */
const TOUCH_ECHO_MS = 800;

/**
 * The ring around the button and the number in its corner. Mounted only while the
 * recording is in its last seconds, so each recording starts the count afresh. Purely
 * visual: the same warning is announced as text by the composer's status line.
 */
function Countdown() {
  const [left, setLeft] = useState(Math.round(ENDING_WARNING_MS / 1000));
  useEffect(() => {
    const id = setInterval(() => setLeft((n) => Math.max(1, n - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <>
      <svg className="thg-cc-ring" viewBox="0 0 52 52" aria-hidden="true" focusable="false">
        <circle cx="26" cy="26" r="24" />
      </svg>
      <span className="thg-cc-count" aria-hidden="true">
        {left}
      </span>
    </>
  );
}

/**
 * Push-to-talk. A pointer clicks to start and clicks again to stop; a finger presses and
 * holds. A button, so Space and Enter toggle it from the keyboard. While a reply or a
 * transcript is pending it only says it is not available (aria-disabled), so focus is not
 * lost the way it would be with a disabled button.
 */
export default function MicButton({
  state,
  ending,
  touch,
  busy,
  disabled,
  describedBy,
  onStart,
  onStop,
  onUnlock,
}: Props) {
  const recording = state === 'recording';
  const inert = busy || state === 'transcribing';
  const label = touch ? VOICE_BUTTON : VOICE_BUTTON_DESKTOP;
  const holding = useRef(false);
  const touchedAt = useRef(-Infinity);

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== 'touch' || inert || disabled) return;
    holding.current = true;
    touchedAt.current = performance.now();
    onUnlock();
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // so the release is heard wherever the finger ends up
    } catch {
      // not supported; pointerup/cancel on the button still arrive in the common case
    }
    if (!recording) onStart({ hold: true });
  };

  const release = (e: PointerEvent<HTMLButtonElement>) => {
    if (!holding.current) return;
    holding.current = false;
    touchedAt.current = performance.now();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // nothing captured
    }
    onUnlock();
    onStop();
  };

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (inert || disabled) return;
    // The click the browser makes after a touch release was already handled above. Keyboard
    // and screen-reader activations (detail 0) and mouse clicks long after a touch toggle.
    if (e.detail > 0 && performance.now() - touchedAt.current < TOUCH_ECHO_MS) return;
    onUnlock();
    if (recording) onStop();
    else onStart({ hold: false });
  };

  return (
    <button
      type="button"
      className="thg-cc-mic"
      data-state={state}
      aria-label={label}
      aria-pressed={recording}
      aria-disabled={inert || undefined}
      aria-describedby={describedBy}
      title={recording ? VOICE_STOP : label}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onClick={handleClick}
      // Android shows a menu on a long press; the hold is the whole point of this button.
      onContextMenu={(e) => e.preventDefault()}
    >
      {recording ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
          <rect x="5" y="5" width="14" height="14" rx="3" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v3" />
        </svg>
      )}
      {ending && <Countdown />}
    </button>
  );
}
