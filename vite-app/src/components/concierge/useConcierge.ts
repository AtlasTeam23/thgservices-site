// The chat widget's state machine (plan section 4.1).
//
// State lives in a small external store rather than in React state so that an
// in-flight request survives the panel being closed, async handlers always see
// the latest thread, and the whole thing can be driven without rendering.
// Whether the panel is open is UI state owned by the always-loaded shell.

import { useState, useSyncExternalStore } from 'react';
import { track } from '../../lib/track';
import { postChat, postLead, type ChatResult, type LeadResult } from './api';
import {
  CALLBACK_CHIP,
  CALLBACK_INTRO,
  CHIPS,
  CONFIRM,
  ENDED,
  ERROR,
  GREETING,
  HANDOFF,
  isKnownChip,
  LEAD_FORM_HEADING,
  LEAD_ONLY,
  OFFER_CHIPS,
  OFFER_NO,
  OFFER_YES,
  RATE_LIMITED,
  TOO_LONG,
  WINDOWS,
} from './copy';
import type { OpenDetail } from './events';
import { EMPTY_LEAD_DRAFT, fillsMissingDetail, LEAD_DRAFT_KEYS, mergeLeadDraft } from './leadDraft';
import { loadState, saveState } from './storage';
import { getToken } from './turnstile';
import type {
  ChatRequest,
  ChatTurn,
  FieldErrors,
  LeadDraft,
  LeadInput,
  LeadRequest,
  Message,
} from './types';
import { buildTranscript, FORM_FIELDS, LIMITS } from './validation';
import { makeMessage, TURNSTILE_AFTER_TURN } from './thread';
import { voiceBonusFormHeading } from './voice/copy';
import { createVoiceController, initialVoiceState, type VoiceState } from './voice/controller';

export type ConciergeStatus = 'idle' | 'sending' | 'leadOnly' | 'ended';

export type { VoiceState };

export type ConciergeState = {
  messages: Message[];
  status: ConciergeStatus;
  chips: readonly string[];
  showLeadForm: boolean;
  leadDone: boolean;
  /** A lead submit is in flight. */
  leadSending: boolean;
  /** The last lead submit failed to deliver; show the phone fallback above the form. */
  leadError: boolean;
  /** Replaces the default delivery-failed text in that notice (null means use the default). */
  leadErrorMessage: string | null;
  /**
   * What the helper has gathered from the conversation so far. Pre-fills the lead
   * form whenever it opens. Kept in memory only, never persisted.
   */
  gatheredLead: LeadDraft;
  /** One line shown above the form when the helper opened it itself (null otherwise). */
  leadHeading: string | null;
  /** The form was opened for the read-aloud bonus: the email is required this time. */
  leadEmailRequired: boolean;
  /** Inline message for the composer (for example TOO_LONG). */
  composerError: string | null;
  /**
   * A voice message shown in the same place (microphone blocked, nothing heard, voice off).
   * Kept apart from composerError because it is not a problem with what was typed.
   */
  voiceNotice: string | null;
  sessionId: string;
  /** User messages sent to the server this session. */
  turn: number;
  voice: VoiceState;
  /** The last seconds of a recording (drives the countdown ring and its text). */
  voiceEnding: boolean;
  /** Read each new reply aloud. */
  speakEnabled: boolean;
  /** Something can read replies aloud, and today's allowance is not used up (drives the speaker toggle). */
  speakAvailable: boolean;
  /** The reply whose audio the browser would not start: it shows a "Tap to hear replies" pill. */
  blockedReplyId: string | null;
  /** Spoken replies are paused and sharing details would add more: show that notice with its chip. */
  readAloudBonus: boolean;
  /** How many spoken replies that offer adds (the Worker's figure, or 5). */
  bonusCount: number;
  /** Show the microphone line under the composer (from the first voice use until the panel closes). */
  voiceDisclosed: boolean;
};

export type SubmitLeadOutcome = { ok: true } | { ok: false; fields?: FieldErrors };

const MAX_THREAD_ENTRIES = 25;

const HANDOFF_PATTERNS = [
  /\b(talk|speak|chat)\s+(to|with)\s+(a\s+|an\s+)?(person|human|real\s+person|someone\s+real|representative)\b/i,
  /\breal person\b/i,
];

/** The visitor asked for a person; answer locally without a network call. */
export const isHandoffRequest = (text: string): boolean =>
  HANDOFF_PATTERNS.some((re) => re.test(text));

/**
 * The visible thread as the server wants it: no local greeting, at most the
 * last 25 entries, never starting on an assistant entry.
 */
export function toChatTurns(messages: Message[]): ChatTurn[] {
  const turns = messages
    .filter((m) => !m.greeting)
    .map((m) => ({ role: m.role, content: m.content.slice(0, LIMITS.messageMax) }))
    .slice(-MAX_THREAD_ENTRIES);
  while (turns.length > 0 && turns[0].role !== 'user') turns.shift();
  return turns;
}

function createController() {
  const stored = loadState();
  const { utm } = stored;

  const onlyGreeting = stored.messages.length === 1 && stored.messages[0].greeting === true;

  // The stored shape (plan section 2.9) has no field for the open form, so work
  // it out from the last message: a reload mid-form or mid-outage resumes there.
  const lastMessage = stored.messages.at(-1);
  const resumeLeadOnly =
    !stored.ended && lastMessage?.role === 'assistant' && lastMessage.content === LEAD_ONLY;
  // Not if the visitor dismissed that very form ("Not now, keep chatting") before the reload.
  const dismissedBeforeReload =
    stored.leadFormDismissedAfter !== undefined && lastMessage?.id === stored.leadFormDismissedAfter;
  const resumeForm =
    !stored.ended &&
    !stored.leadSubmitted &&
    !dismissedBeforeReload &&
    lastMessage?.role === 'assistant' &&
    (lastMessage.content === CALLBACK_INTRO || lastMessage.content === LEAD_ONLY);
  // A form the helper opened itself (readyToConfirm) is not recognisable from its message
  // text, so it was stored with the id of the message it sat under.
  const resumeReadyForm =
    !stored.ended &&
    !stored.leadSubmitted &&
    stored.leadFormOpenAfter !== undefined &&
    lastMessage?.id === stored.leadFormOpenAfter;

  // What the helper had gathered when the visitor last dismissed the form, so a later
  // readyToConfirm only brings it back for something new. In memory only; null until a dismissal.
  let dismissedSnapshot: LeadDraft | null = null;
  // The persisted half of the same fact: the last message at that moment.
  let dismissedAfterId: string | undefined = stored.leadFormDismissedAfter;
  // The id of the message a readyToConfirm form is open under (persisted), or undefined.
  let openFormAfterId: string | undefined = resumeReadyForm ? stored.leadFormOpenAfter : undefined;
  // Fields the visitor typed themselves; a later model reply may not overwrite these.
  const visitorEdited = new Set<keyof LeadDraft>();

  /** The visitor asked for the form (or lead-only mode needs it): any earlier "not now" is void. */
  const clearDismissal = () => {
    dismissedSnapshot = null;
    dismissedAfterId = undefined;
  };

  let state: ConciergeState = {
    messages: stored.messages,
    status: stored.ended ? 'ended' : resumeLeadOnly ? 'leadOnly' : 'idle',
    chips: onlyGreeting && !stored.ended ? CHIPS : [],
    showLeadForm: resumeForm || resumeReadyForm,
    leadDone: stored.leadSubmitted,
    leadSending: false,
    leadError: false,
    leadErrorMessage: null,
    // Seeded from the stored draft (present only while a readyToConfirm form was open), so
    // even after dismissing it a "Request a callback" comes up pre-filled.
    gatheredLead: { ...EMPTY_LEAD_DRAFT, ...stored.leadDraft },
    leadHeading: resumeReadyForm ? LEAD_FORM_HEADING : null,
    leadEmailRequired: false,
    composerError: null,
    sessionId: stored.sessionId,
    turn: stored.messages.filter((m) => m.role === 'user' && !m.greeting).length,
    ...initialVoiceState(),
  };

  const listeners = new Set<() => void>();
  const getState = () => state;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const set = (patch: Partial<ConciergeState>) => {
    state = { ...state, ...patch };
    saveState({
      sessionId: state.sessionId,
      messages: state.messages,
      leadSubmitted: state.leadDone,
      ended: state.status === 'ended',
      utm,
      leadFormDismissedAfter: dismissedAfterId,
      leadFormOpenAfter: openFormAfterId,
      // The transcript already holds this data; it only needs to survive while the form is open.
      leadDraft: openFormAfterId ? state.gatheredLead : undefined,
    });
    listeners.forEach((l) => l());
  };

  const push = (message: Message, patch: Partial<ConciergeState> = {}) =>
    set({ messages: [...state.messages, message], ...patch });

  const voice = createVoiceController({
    get: getState,
    patch: set,
    send: (text) => sendText(text),
  });

  /** Read the newest assistant message added since `fromIndex`, if any. */
  const speakNewReplies = (fromIndex: number) => {
    const reply = state.messages
      .slice(fromIndex)
      .filter((m) => m.role === 'assistant' && !m.greeting)
      .at(-1);
    if (reply) voice.speakReply(reply.content, reply.id);
  };

  const openCallbackForm = (label: string) => {
    if (state.leadDone || state.showLeadForm || state.status === 'ended') {
      set({ chips: [] });
      return;
    }
    // The visitor asked for the form themselves: any earlier "not now" no longer applies.
    clearDismissal();
    set({
      messages: [
        ...state.messages,
        makeMessage('user', label),
        makeMessage('assistant', CALLBACK_INTRO),
      ],
      showLeadForm: true,
      leadHeading: null,
      leadEmailRequired: false,
      leadError: false,
      chips: [],
    });
    track('concierge_lead_form_shown');
  };

  /**
   * "Share my details" (read-aloud paused, a bonus on offer): the same lead form, pre-filled from
   * the conversation, with the email required this time. No chat messages: it is not a question.
   */
  const shareDetails = () => {
    if (state.leadDone || state.showLeadForm || state.status === 'ended') return;
    clearDismissal();
    voice.cancelVoice();
    voice.stopSpeaking();
    set({
      showLeadForm: true,
      leadHeading: voiceBonusFormHeading(state.bonusCount),
      leadEmailRequired: true,
      leadError: false,
      chips: [],
    });
    track('concierge_lead_form_shown');
  };

  const applyChatResult = (res: ChatResult) => {
    switch (res.kind) {
      case 'ok': {
        const { reply, intent, offerCallback, readyToConfirm, lead } = res.data;
        if (intent === 'off_topic') track('concierge_off_topic');
        // Details the helper has gathered so far; a later empty field never erases one, and
        // a field the visitor typed themselves is never overwritten.
        const gatheredLead = mergeLeadDraft(state.gatheredLead, lead, visitorEdited);
        // The helper says it has what it needs: show the form right under this reply,
        // pre-filled, for the visitor to check the consent box and send. Defensive: only if
        // the cleaned details really hold a name and a 10-digit number; never if a lead was
        // already sent or the form is already up; and after a dismissal ("Not now, keep
        // chatting") only when a detail that was missing then (name, phone, email, business,
        // callback window) has been given since. A changed value or a re-worded need does not
        // count (the "Yes, call me" chip covers those), else it would pop up after every reply.
        const pending = readyToConfirm && !state.leadDone && !state.showLeadForm;
        const hasContact = gatheredLead.name !== '' && /^\d{10}$/.test(gatheredLead.phone);
        const allowedAgain =
          dismissedSnapshot === null || fillsMissingDetail(dismissedSnapshot, lead);
        const openForm = pending && hasContact && allowedAgain;
        const message = makeMessage('assistant', reply, intent === 'handoff' ? { callLink: true } : {});
        if (openForm) {
          clearDismissal();
          openFormAfterId = message.id;
        }
        push(message, {
          status: 'idle',
          gatheredLead,
          ...(openForm ? { showLeadForm: true, leadHeading: LEAD_FORM_HEADING, leadError: false } : {}),
          // A callback offer brings both chips. If the model said "check the box" but the form
          // is not coming up (dismissed, or details missing), the reply would point at nothing,
          // so offer the one-tap way in: "Yes, call me" opens it pre-filled.
          chips:
            offerCallback && !state.leadDone && !state.showLeadForm && !openForm
              ? OFFER_CHIPS
              : pending && !openForm
                ? [OFFER_YES]
                : [],
        });
        // Counts every opening, including re-opens after a dismissal: it is a count of times
        // the form was shown, not of distinct visitors.
        if (openForm) track('concierge_lead_form_shown');
        return;
      }
      case 'rate_limited':
        track('concierge_rate_limited');
        push(makeMessage('assistant', res.reply ?? RATE_LIMITED), { status: 'idle', chips: [] });
        return;
      case 'ended':
        push(makeMessage('assistant', res.reply ?? ENDED), {
          status: 'ended',
          chips: [],
          showLeadForm: false,
        });
        return;
      case 'lead_only': {
        const showForm = !state.leadDone;
        const newlyShown = showForm && !state.showLeadForm;
        if (newlyShown) clearDismissal();
        push(makeMessage('assistant', res.reply ?? LEAD_ONLY), {
          status: 'leadOnly',
          chips: [],
          showLeadForm: showForm,
          leadHeading: newlyShown ? null : state.leadHeading,
        });
        if (newlyShown) track('concierge_lead_form_shown');
        return;
      }
      case 'too_long':
        push(makeMessage('assistant', res.reply ?? TOO_LONG), { status: 'idle', chips: [] });
        return;
      case 'verification_required':
      case 'error':
        push(makeMessage('assistant', ERROR), { status: 'idle', chips: [] });
        return;
    }
  };

  const converse = async (thread: Message[], turn: number) => {
    const sessionId = state.sessionId;
    const build = (token: string | null): ChatRequest => ({
      sessionId,
      messages: toChatTurns(thread),
      ...(token ? { turnstileToken: token } : {}),
    });

    let res: ChatResult;
    try {
      const token = turn > TURNSTILE_AFTER_TURN ? await getToken() : null;
      res = await postChat(build(token));
      if (res.kind === 'verification_required') {
        // Fetch a token and retry once; a second demand is a plain error.
        const retryToken = await getToken();
        res = retryToken
          ? await postChat(build(retryToken))
          : { kind: 'error', reason: 'server' };
      }
    } catch {
      res = { kind: 'error', reason: 'network' };
    }
    const before = state.messages.length;
    applyChatResult(res);
    speakNewReplies(before);
  };

  /** The send path shared by typing and by a finished voice transcript. */
  const sendText = async (raw: string): Promise<void> => {
    if (state.status !== 'idle') return;
    const text = raw.trim();
    if (!text) return;
    if (text.length > LIMITS.messageMax) {
      set({ composerError: TOO_LONG });
      return;
    }

    voice.stopSpeaking(); // any new input stops the reading
    const userMessage = makeMessage('user', text);

    if (isHandoffRequest(text)) {
      const before = state.messages.length;
      set({
        messages: [
          ...state.messages,
          userMessage,
          makeMessage('assistant', HANDOFF, { callLink: true }),
        ],
        chips: [],
        composerError: null,
        voiceNotice: null,
      });
      speakNewReplies(before);
      return;
    }

    const thread = [...state.messages, userMessage];
    const turn = state.turn + 1;
    set({ messages: thread, turn, status: 'sending', chips: [], composerError: null, voiceNotice: null });
    track('concierge_message_sent', { turn_number: turn });
    await converse(thread, turn);
  };

  /** Typed (or chip) input: a recording or transcript in progress is dropped in its favour. */
  const send = (raw: string): Promise<void> => {
    voice.cancelVoice();
    return sendText(raw);
  };

  const chip = async (label: string): Promise<void> => {
    if (state.status === 'ended') return;
    voice.cancelVoice();
    voice.stopSpeaking();
    // Only the widget's own chip labels are analytics values; never pass anything else along.
    track('concierge_quick_reply', isKnownChip(label) ? { chip: label } : undefined);
    if (label === CALLBACK_CHIP || label === OFFER_YES) {
      openCallbackForm(label);
      return;
    }
    if (label === OFFER_NO) {
      set({ chips: [] });
      return;
    }
    await send(label);
  };

  const handleOpen = async (detail: OpenDetail): Promise<void> => {
    void voice.checkVoice();
    if (state.messages.length === 0) {
      set({
        messages: [makeMessage('assistant', GREETING, { greeting: true })],
        chips: state.status === 'ended' ? [] : CHIPS,
      });
    }
    if (detail.quickReply) await chip(detail.quickReply);
  };

  const submitLead = async (input: LeadInput): Promise<SubmitLeadOutcome> => {
    if (state.leadSending || state.leadDone) return { ok: false };
    set({ leadSending: true, leadError: false, leadErrorMessage: null });

    let res: LeadResult;
    try {
      // Null when Turnstile is not configured; the server then skips verification.
      const token = await getToken();
      const request: LeadRequest = {
        ...input,
        sessionId: state.sessionId,
        transcript: buildTranscript(state.messages),
        page: { url: window.location.href.slice(0, LIMITS.pageUrlMax), utm },
        ...(token ? { turnstileToken: token } : {}),
      };
      res = await postLead(request);
    } catch {
      res = { kind: 'error', reason: 'network' };
    }

    if (res.kind === 'ok') {
      track('concierge_lead_submitted', {
        callback_window: input.callbackWindow,
        delivery: res.delivery,
      });
      track('concierge_lead');
      // A lead with an email is what earns the read-aloud bonus, if one is on offer; any lead
      // closes the offer (the chip that opened the form could not be used again).
      voice.noteLeadSubmitted(Boolean(input.email));
      const first = input.name.split(/\s+/)[0];
      openFormAfterId = undefined; // sent: nothing left to resume after a reload
      push(makeMessage('assistant', CONFIRM(first, WINDOWS[input.callbackWindow])), {
        showLeadForm: false,
        leadHeading: null,
        leadEmailRequired: false,
        leadDone: true,
        leadSending: false,
        leadError: false,
        leadErrorMessage: null,
        chips: [],
      });
      return { ok: true };
    }
    if (res.kind === 'validation') {
      const fields: FieldErrors = {};
      for (const name of FORM_FIELDS) {
        const message = res.fields[name];
        if (typeof message === 'string') fields[name] = message;
      }
      if (Object.keys(fields).length > 0) {
        set({ leadSending: false });
        return { ok: false, fields };
      }
      // The server objected to something the form has no field for (session,
      // transcript, page) or gave no detail: say so in the notice instead.
      const first = Object.values(res.fields).find((m) => m.trim().length > 0);
      track('concierge_lead_failed');
      set({
        leadSending: false,
        leadError: true,
        leadErrorMessage: first ? first.trim().slice(0, 200) : null,
      });
      return { ok: false };
    }
    track('concierge_lead_failed');
    set({ leadSending: false, leadError: true, leadErrorMessage: null });
    return { ok: false };
  };

  /**
   * "Not now, keep chatting": close the form and bring the composer back. What the
   * helper gathered stays, and so does anything the visitor typed in the form (`edits`),
   * so a later "Yes, call me" re-opens it pre-filled. A later readyToConfirm only brings
   * the form back for something new (see applyChatResult). Lead-only mode keeps its form
   * (there is nothing to chat with), and a lead that is being sent cannot be dismissed.
   * No analytics event.
   */
  const dismissLeadForm = (edits?: LeadDraft) => {
    if (!state.showLeadForm || state.status !== 'idle' || state.leadSending) return;

    let gatheredLead = state.gatheredLead;
    if (edits) {
      const merged: Record<string, string> = { ...gatheredLead };
      for (const key of LEAD_DRAFT_KEYS) {
        if (edits[key] === gatheredLead[key]) continue; // left as it was
        merged[key] = edits[key];
        // Typed a value: the model may not overwrite it. Cleared it: the model may fill it again.
        if (edits[key] !== '') visitorEdited.add(key);
        else visitorEdited.delete(key);
      }
      gatheredLead = merged as unknown as LeadDraft;
    }

    dismissedSnapshot = { ...gatheredLead };
    dismissedAfterId = state.messages.at(-1)?.id;
    openFormAfterId = undefined; // dismissed: a reload must not resume it
    set({
      showLeadForm: false,
      leadHeading: null,
      leadEmailRequired: false,
      leadError: false,
      leadErrorMessage: null,
      composerError: null,
      gatheredLead,
    });
  };

  const clearComposerError = () => {
    if (state.composerError !== null || state.voiceNotice !== null) {
      set({ composerError: null, voiceNotice: null });
    }
  };

  return {
    getState,
    subscribe,
    actions: {
      handleOpen,
      send,
      chip,
      submitLead,
      dismissLeadForm,
      clearComposerError,
      startVoice: voice.startVoice,
      stopVoice: voice.stopVoice,
      cancelVoice: voice.cancelVoice,
      cancelRecording: voice.cancelRecording,
      stopAll: voice.stopAll,
      setActive: voice.setActive,
      stopSpeaking: voice.stopSpeaking,
      setSpeakEnabled: voice.setSpeakEnabled,
      playBlocked: voice.playBlocked,
      shareDetails,
      unlockSpeech: voice.unlock,
      subscribeLevel: voice.subscribeLevel,
    },
  };
}

export function useConcierge() {
  const [controller] = useState(createController);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState
  );
  return { ...state, ...controller.actions };
}
