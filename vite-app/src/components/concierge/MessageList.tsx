import { useEffect, useRef, type ReactNode } from 'react';
import { track } from '../../lib/track';
import { PHONE_DISPLAY, PHONE_HREF } from './copy';
import PhoneText from './PhoneText';
import type { Message } from './types';

type Props = {
  /** False while the panel is closed (display: none), when there is nothing to scroll. */
  open?: boolean;
  messages: Message[];
  /** The assistant is working on a reply. */
  typing: boolean;
  /** The lead form is showing in `children`; scroll it into view instead of the bottom. */
  formVisible: boolean;
  /** Rendered after the log inside the same scroll container (lead form). */
  children?: ReactNode;
};

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function MessageList({ open = true, messages, typing, formVisible, children }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);

  // Follow the conversation: bottom for new messages. When the lead form
  // appears, line up the message that introduces it with the top so the visitor
  // reads the intro and sees the first fields beneath it.
  // Reopening the panel counts too: a hidden list forgets its scroll position.
  useEffect(() => {
    const reopened = open && !wasOpen.current;
    wasOpen.current = open;
    const el = scrollRef.current;
    if (!open || !el || typeof el.scrollTo !== 'function') return;
    const rows = el.querySelectorAll<HTMLElement>('.thg-cc-row');
    const intro = formVisible ? rows[rows.length - 1] : undefined;
    const top = intro ? Math.max(0, intro.offsetTop - 12) : el.scrollHeight;
    // Jump (no animation) when reopening, so it does not slide down from the top.
    el.scrollTo({ top, behavior: reopened || prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [open, messages.length, typing, formVisible]);

  return (
    // data-lenis-prevent: without it Lenis hijacks the wheel and the list cannot scroll.
    <div ref={scrollRef} className="thg-cc-scroll" data-lenis-prevent>
      <div
        className="thg-cc-log"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="Conversation"
      >
        <ol className="thg-cc-list">
          {messages.map((m) => (
            // The visitor just typed this; announcing it back to them is noise.
            <li
              key={m.id}
              className={`thg-cc-row thg-cc-row--${m.role}`}
              aria-live={m.role === 'user' ? 'off' : undefined}
            >
              <div className={`thg-cc-msg thg-cc-msg--${m.role}`}>
                <span className="thg-cc-sr">{m.role === 'user' ? 'You: ' : 'THG helper: '}</span>
                {m.role === 'assistant' ? <PhoneText text={m.content} /> : m.content}
              </div>
              {m.role === 'assistant' && m.callLink && !m.content.includes(PHONE_DISPLAY) && (
                <a
                  className="thg-cc-calllink"
                  href={PHONE_HREF}
                  onClick={() => track('concierge_call_click', { location: 'panel' })}
                >
                  Call {PHONE_DISPLAY}
                </a>
              )}
            </li>
          ))}
          {typing && (
            <li className="thg-cc-row thg-cc-row--assistant">
              <div className="thg-cc-msg thg-cc-msg--assistant thg-cc-typing">
                <span className="thg-cc-sr">THG helper is typing</span>
                <span className="thg-cc-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            </li>
          )}
        </ol>
      </div>
      {children}
    </div>
  );
}
