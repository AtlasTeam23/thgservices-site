import { useEffect, useRef, type RefObject } from 'react';
import { getLenis } from '../../hooks/useLenis';
import { track } from '../../lib/track';
import './concierge.css';
import Composer from './Composer';
import {
  DISCLOSURE,
  FOOTER_AI,
  FOOTER_CALL,
  FOOTER_PRIVACY,
  PANEL_TITLE,
  PHONE_DISPLAY,
  PHONE_HREF,
  PRIVACY_HREF,
} from './copy';
import Equalizer from './Equalizer';
import type { OpenDetail } from './events';
import LeadForm from './LeadForm';
import MessageList from './MessageList';
import QuickReplies from './QuickReplies';
import SpeakToggle from './SpeakToggle';
import { useAvailableHeight } from './useAvailableHeight';
import { useConcierge } from './useConcierge';
import { useFocusTrap } from './useFocusTrap';
import { useMediaQuery } from './useMediaQuery';

export type OpenRequest = OpenDetail & { id: number };

// Full-screen layout. Keep in step with the media query in concierge.css.
const PHONE_QUERY = '(max-width: 640px), (max-height: 500px)';

/** Below this much usable height (the on-screen keyboard counts) the panel drops its extras. */
const SHORT_BELOW_PX = 480;

export type ChatPanelProps = {
  open: boolean;
  /** Changes every time the visitor asks to open the chat. */
  request: OpenRequest | null;
  onClose: () => void;
  /** The chat bubble; focus returns here on close. */
  returnFocusRef: RefObject<HTMLElement | null>;
};

export default function ChatPanel({ open, request, onClose, returnFocusRef }: ChatPanelProps) {
  const chat = useConcierge();
  const { handleOpen, chips, showLeadForm, status, voice } = chat;
  const { stopAll, cancelRecording, setActive, stopSpeaking } = chat;
  const panelRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useMediaQuery(PHONE_QUERY);
  // On a touch screen, putting focus in the textarea raises the keyboard over the greeting.
  const touch = useMediaQuery('(pointer: coarse)');
  const short = useAvailableHeight() < SHORT_BELOW_PX;

  // Greeting and quick reply, once per open request.
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!request || handled.current === request.id) return;
    handled.current = request.id;
    void handleOpen(request);
  }, [request, handleOpen]);

  useFocusTrap(panelRef, {
    active: open,
    onEscape: onClose,
    returnFocusRef,
    getInitialFocus: () => (touch ? panelRef.current : composerRef.current),
  });

  // A chip or the composer can vanish under the focus ring. Put focus back only if it
  // was lost (it is on <body> or nowhere); if it is on a real element, in the chat or
  // anywhere else on the page, leave it alone.
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const composer = composerRef.current;
    const target = !touch && composer && !composer.disabled ? composer : panel;
    target.focus({ preventScroll: true });
    // `voice`: the mic (voice switched off) or the header equalizer (the reading stopped) can
    // vanish under the focus ring.
  }, [open, touch, chips, showLeadForm, status, voice]);

  // The panel stays mounted while closed: closing it must release the microphone and stop the
  // voice, and replies are read aloud only while it is open and the tab is visible. An unmount
  // (the page tearing it down) does the same.
  useEffect(() => {
    setActive(open && !document.hidden);
    if (!open) stopAll();
  }, [open, setActive, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  // A hidden tab must not keep recording or keep talking; a transcript already on its way is
  // left to finish (its reply is shown, not read).
  useEffect(() => {
    const onVisibility = () => {
      setActive(open && !document.hidden);
      if (document.hidden) {
        cancelRecording();
        stopSpeaking();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [open, setActive, cancelRecording, stopSpeaking]);

  // Full-screen on phones: track the visual viewport so the on-screen keyboard
  // never covers the composer, and keep the page behind from scrolling. Lenis
  // smooth-scrolls the page on its own, so it has to be stopped as well as
  // overflow being locked.
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !isMobile || !panel) return;
    const vv = window.visualViewport;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    getLenis()?.stop();

    const sync = () => {
      if (!vv) return;
      panel.style.setProperty('--thg-cc-vh', `${vv.height}px`);
      panel.style.setProperty('--thg-cc-vtop', `${vv.offsetTop}px`);
    };
    sync();
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);
    return () => {
      root.style.overflow = previousOverflow;
      getLenis()?.start();
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
      panel.style.removeProperty('--thg-cc-vh');
      panel.style.removeProperty('--thg-cc-vtop');
    };
  }, [open, isMobile]);

  const showComposer = !showLeadForm && status !== 'leadOnly';

  return (
    <div
      ref={panelRef}
      className="thg-cc-panel thg-cc-surface"
      role="dialog"
      aria-labelledby="thg-cc-title"
      aria-describedby="thg-cc-disclosure"
      aria-modal={isMobile ? true : undefined}
      // Lenis must leave wheel and touch alone anywhere over the panel, not only in the
      // scrolling list, or it smooth-scrolls the page underneath.
      data-lenis-prevent
      data-analytics-location="concierge"
      data-short={short ? 'true' : undefined}
      tabIndex={-1}
      hidden={!open}
    >
      <header className="thg-cc-header">
        <div className="thg-cc-heading">
          <h2 id="thg-cc-title" className="thg-cc-title">
            {PANEL_TITLE}
          </h2>
          <span className="thg-cc-badge" aria-hidden="true">
            AI
          </span>
        </div>
        {(voice === 'recording' || voice === 'transcribing' || voice === 'speaking') && (
          <Equalizer
            mode={voice === 'recording' ? 'listening' : voice}
            subscribeLevel={chat.subscribeLevel}
            onStop={stopSpeaking}
          />
        )}
        {voice !== 'off' && chat.speakAvailable && (
          <SpeakToggle
            pressed={chat.speakEnabled}
            onToggle={() => chat.setSpeakEnabled(!chat.speakEnabled)}
            showLabel={touch}
          />
        )}
        {/* Shown only on short screens, where the footer's call link is dropped to save a line. */}
        <a
          className="thg-cc-header-call"
          href={PHONE_HREF}
          hidden={!short}
          aria-label={`Call ${PHONE_DISPLAY}`}
          onClick={() => track('concierge_call_click', { location: 'panel' })}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
          </svg>
        </a>
        <button type="button" className="thg-cc-close" aria-label="Close chat" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </header>

      <p id="thg-cc-disclosure" className="thg-cc-disclosure">
        {DISCLOSURE}
      </p>

      <MessageList
        open={open}
        messages={chat.messages}
        typing={status === 'sending'}
        formVisible={showLeadForm}
        blockedReplyId={chat.blockedReplyId}
        onPlayBlocked={chat.playBlocked}
      >
        {showLeadForm && (
          <LeadForm
            onSubmit={chat.submitLead}
            sending={chat.leadSending}
            deliveryFailed={chat.leadError}
            failureMessage={chat.leadErrorMessage}
            prefill={chat.gatheredLead}
            heading={chat.leadHeading}
            // Lead-only mode has nothing to go back to, so no "keep chatting" there.
            onDismiss={status === 'idle' ? chat.dismissLeadForm : undefined}
            emailRequired={chat.leadEmailRequired}
          />
        )}
      </MessageList>

      {!showLeadForm && <QuickReplies chips={chips} onSelect={(c) => void chat.chip(c)} />}

      {showComposer && (
        <Composer
          textareaRef={composerRef}
          onSend={(text) => void chat.send(text)}
          onEdit={() => {
            chat.clearComposerError();
            stopSpeaking(); // typing is new input: the reading stops
          }}
          busy={status === 'sending'}
          disabled={status === 'ended'}
          error={chat.composerError}
          notice={chat.voiceNotice}
          readAloudBonus={
            voice !== 'off' && chat.readAloudBonus && !chat.leadDone
              ? { count: chat.bonusCount, onShare: chat.shareDetails }
              : undefined
          }
          voice={{
            state: voice,
            ending: chat.voiceEnding,
            disclosed: chat.voiceDisclosed,
            touch,
            onStart: (opts) => void chat.startVoice(opts),
            onStop: chat.stopVoice,
            onUnlock: chat.unlockSpeech,
          }}
        />
      )}

      <footer className="thg-cc-footer">
        <a
          className="thg-cc-link thg-cc-footer-call"
          href={PHONE_HREF}
          hidden={short}
          onClick={() => track('concierge_call_click', { location: 'panel' })}
        >
          {FOOTER_CALL}
        </a>
        <p className="thg-cc-footnote">
          {FOOTER_AI}{' '}
          <a className="thg-cc-link" href={PRIVACY_HREF} target="_blank" rel="noopener noreferrer">
            {FOOTER_PRIVACY}
            <span className="thg-cc-sr"> (opens in a new tab)</span>
          </a>
        </p>
      </footer>
    </div>
  );
}
