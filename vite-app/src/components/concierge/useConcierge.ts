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
  LEAD_ONLY,
  OFFER_CHIPS,
  OFFER_NO,
  OFFER_YES,
  RATE_LIMITED,
  TOO_LONG,
  WINDOWS,
} from './copy';
import type { OpenDetail } from './events';
import { loadState, newId, saveState } from './storage';
import { getToken } from './turnstile';
import type {
  ChatRequest,
  ChatTurn,
  FieldErrors,
  LeadInput,
  LeadRequest,
  Message,
} from './types';
import { buildTranscript, FORM_FIELDS, LIMITS } from './validation';

export type ConciergeStatus = 'idle' | 'sending' | 'leadOnly' | 'ended';

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
  /** Inline message for the composer (for example TOO_LONG). */
  composerError: string | null;
  sessionId: string;
  /** User messages sent to the server this session. */
  turn: number;
};

export type SubmitLeadOutcome = { ok: true } | { ok: false; fields?: FieldErrors };

const MAX_THREAD_ENTRIES = 25;
const TURNSTILE_AFTER_TURN = 10;

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

const makeMessage = (
  role: Message['role'],
  content: string,
  extra: Partial<Message> = {}
): Message => ({
  id: newId(),
  role,
  content,
  at: new Date().toISOString(),
  ...extra,
});

function createController() {
  const stored = loadState();
  const { utm } = stored;

  const onlyGreeting = stored.messages.length === 1 && stored.messages[0].greeting === true;

  // The stored shape (plan section 2.9) has no field for the open form, so work
  // it out from the last message: a reload mid-form or mid-outage resumes there.
  const lastMessage = stored.messages.at(-1);
  const resumeLeadOnly =
    !stored.ended && lastMessage?.role === 'assistant' && lastMessage.content === LEAD_ONLY;
  const resumeForm =
    !stored.ended &&
    !stored.leadSubmitted &&
    lastMessage?.role === 'assistant' &&
    (lastMessage.content === CALLBACK_INTRO || lastMessage.content === LEAD_ONLY);

  let state: ConciergeState = {
    messages: stored.messages,
    status: stored.ended ? 'ended' : resumeLeadOnly ? 'leadOnly' : 'idle',
    chips: onlyGreeting && !stored.ended ? CHIPS : [],
    showLeadForm: resumeForm,
    leadDone: stored.leadSubmitted,
    leadSending: false,
    leadError: false,
    leadErrorMessage: null,
    composerError: null,
    sessionId: stored.sessionId,
    turn: stored.messages.filter((m) => m.role === 'user' && !m.greeting).length,
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
    });
    listeners.forEach((l) => l());
  };

  const push = (message: Message, patch: Partial<ConciergeState> = {}) =>
    set({ messages: [...state.messages, message], ...patch });

  const openCallbackForm = (label: string) => {
    if (state.leadDone || state.showLeadForm || state.status === 'ended') {
      set({ chips: [] });
      return;
    }
    set({
      messages: [
        ...state.messages,
        makeMessage('user', label),
        makeMessage('assistant', CALLBACK_INTRO),
      ],
      showLeadForm: true,
      leadError: false,
      chips: [],
    });
    track('concierge_lead_form_shown');
  };

  const applyChatResult = (res: ChatResult) => {
    switch (res.kind) {
      case 'ok': {
        const { reply, intent, offerCallback } = res.data;
        if (intent === 'off_topic') track('concierge_off_topic');
        push(makeMessage('assistant', reply, intent === 'handoff' ? { callLink: true } : {}), {
          status: 'idle',
          chips: offerCallback && !state.leadDone && !state.showLeadForm ? OFFER_CHIPS : [],
        });
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
        push(makeMessage('assistant', res.reply ?? LEAD_ONLY), {
          status: 'leadOnly',
          chips: [],
          showLeadForm: showForm,
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
    applyChatResult(res);
  };

  const send = async (raw: string): Promise<void> => {
    if (state.status !== 'idle') return;
    const text = raw.trim();
    if (!text) return;
    if (text.length > LIMITS.messageMax) {
      set({ composerError: TOO_LONG });
      return;
    }

    const userMessage = makeMessage('user', text);

    if (isHandoffRequest(text)) {
      set({
        messages: [
          ...state.messages,
          userMessage,
          makeMessage('assistant', HANDOFF, { callLink: true }),
        ],
        chips: [],
        composerError: null,
      });
      return;
    }

    const thread = [...state.messages, userMessage];
    const turn = state.turn + 1;
    set({ messages: thread, turn, status: 'sending', chips: [], composerError: null });
    track('concierge_message_sent', { turn_number: turn });
    await converse(thread, turn);
  };

  const chip = async (label: string): Promise<void> => {
    if (state.status === 'ended') return;
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
      const first = input.name.split(/\s+/)[0];
      push(makeMessage('assistant', CONFIRM(first, WINDOWS[input.callbackWindow])), {
        showLeadForm: false,
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

  const clearComposerError = () => {
    if (state.composerError !== null) set({ composerError: null });
  };

  return {
    getState,
    subscribe,
    actions: { handleOpen, send, chip, submitLead, clearComposerError },
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
