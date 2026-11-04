import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { TOO_LONG } from './copy';
import MicButton from './MicButton';
import type { VoiceState } from './useConcierge';
import { LIMITS } from './validation';
import {
  VOICE_DISCLOSURE,
  VOICE_ENDING_SOON,
  VOICE_LISTENING,
  VOICE_SHARE_DETAILS,
  VOICE_TRANSCRIBING,
  voiceSpokenLimitBonus,
} from './voice/copy';

/** Push-to-talk, as the composer needs it. Leave out (or state 'off') for a text-only composer. */
export type ComposerVoice = {
  state: VoiceState;
  ending: boolean;
  /** Show the microphone line under the composer. */
  disclosed: boolean;
  /** A touch screen: press and hold rather than click. */
  touch: boolean;
  onStart: (opts: { hold: boolean }) => void;
  onStop: () => void;
  onUnlock: () => void;
};

type Props = {
  onSend: (text: string) => void;
  /** Called on every edit so the parent can clear a stale error. */
  onEdit?: () => void;
  /** A reply is pending; keep the text but do not send. */
  busy: boolean;
  /** The chat has ended. */
  disabled: boolean;
  error: string | null;
  /** A voice message (microphone blocked, nothing heard). Shown like an error, but the text box is not "invalid". */
  notice?: string | null;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  voice?: ComposerVoice;
  /**
   * Read-aloud is paused and sharing details would add more: the notice and a chip that opens
   * the lead form. It stays up (unlike a notice) until the details are shared.
   */
  readAloudBonus?: { count: number; onShare: () => void };
};

const MAX_ROWS_PX = 4 * 22 + 20; // four lines of 22px plus vertical padding
const formatCount = (n: number) => n.toLocaleString('en-US');

export default function Composer({
  onSend,
  onEdit,
  busy,
  disabled,
  error,
  notice,
  textareaRef,
  voice,
  readAloudBonus,
}: Props) {
  const [value, setValue] = useState('');
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? ownRef;
  const labelId = useId();
  const messageId = useId();
  const noteId = useId();

  const trimmed = value.trim();
  const length = trimmed.length;
  const tooLong = length > LIMITS.messageMax;
  const canSend = !disabled && !busy && length > 0 && !tooLong;
  const problem = error ?? (tooLong ? TOO_LONG : null);
  const message = problem ?? notice ?? null;

  const micOn = voice !== undefined && voice.state !== 'off';
  // What the microphone is doing, in words, for screen readers and for sighted visitors alike.
  const voiceStatus =
    voice?.state === 'recording'
      ? voice.ending
        ? VOICE_ENDING_SOON
        : VOICE_LISTENING
      : voice?.state === 'transcribing'
        ? VOICE_TRANSCRIBING
        : '';

  // Grow with the text, up to four lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  }, [value, ref]);

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed);
    setValue('');
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form className="thg-cc-composer" onSubmit={handleSubmit}>
      <label id={labelId} htmlFor={`${labelId}-input`} className="thg-cc-sr">
        Message
      </label>
      <div className="thg-cc-composer-row">
        <textarea
          id={`${labelId}-input`}
          ref={ref}
          className="thg-cc-input thg-cc-textarea"
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={disabled ? 'This chat has ended' : 'Type your question…'}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? messageId : undefined}
          autoComplete="off"
          enterKeyHint="send"
          onChange={(e) => {
            setValue(e.target.value);
            onEdit?.();
          }}
          onKeyDown={handleKeyDown}
        />
        {micOn && (
          <MicButton
            state={voice.state}
            ending={voice.ending}
            touch={voice.touch}
            busy={busy}
            disabled={disabled}
            describedBy={voice.disclosed ? noteId : undefined}
            onStart={voice.onStart}
            onStop={voice.onStop}
            onUnlock={voice.onUnlock}
          />
        )}
        <button
          type="submit"
          className="thg-cc-send"
          aria-label="Send message"
          disabled={!canSend}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </button>
      </div>
      <div className="thg-cc-meta">
        {/* Always in the page, so text added later is announced (an alert that appears
            already filled is often missed). */}
        <span id={messageId} className="thg-cc-error" role="alert">
          {message}
        </span>
        {micOn && (
          <span className="thg-cc-voice-status" role="status">
            {voiceStatus}
          </span>
        )}
        {length > 0 && (
          <span className={`thg-cc-counter${tooLong ? ' thg-cc-counter--over' : ''}`}>
            {`${formatCount(length)} / ${formatCount(LIMITS.messageMax)}`}
          </span>
        )}
      </div>
      {/* Always in the page, empty until there is something to say, so the text added later is
          announced (a status that appears already filled is often missed). The chip is beside
          it, not inside it. */}
      <div className="thg-cc-readaloud" data-active={readAloudBonus ? 'true' : undefined}>
        <p className="thg-cc-readaloud-text" role="status">
          {readAloudBonus ? voiceSpokenLimitBonus(readAloudBonus.count) : null}
        </p>
        {readAloudBonus && (
          <button type="button" className="thg-cc-chip" onClick={readAloudBonus.onShare}>
            {VOICE_SHARE_DETAILS}
          </button>
        )}
      </div>
      {micOn && voice.disclosed && (
        <p id={noteId} className="thg-cc-voice-note">
          {VOICE_DISCLOSURE}
        </p>
      )}
    </form>
  );
}
