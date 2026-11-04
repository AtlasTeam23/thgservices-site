import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ChatResult, LeadResult } from '../api';

vi.mock('../api', () => ({ postChat: vi.fn(), postLead: vi.fn() }));
vi.mock('../turnstile', () => ({ getToken: vi.fn() }));
vi.mock('../../../lib/track', () => ({ track: vi.fn() }));

import { postChat, postLead } from '../api';
import { getToken } from '../turnstile';
import { track } from '../../../lib/track';
import { isHandoffRequest, toChatTurns, useConcierge } from '../useConcierge';
import type { OpenDetail } from '../events';
import type { Intent, LeadDraft, Message } from '../types';
import { EMPTY_LEAD_DRAFT } from '../leadDraft';
import { STORAGE_KEY } from '../storage';
import * as copy from '../copy';

const postChatMock = vi.mocked(postChat);
const postLeadMock = vi.mocked(postLead);
const getTokenMock = vi.mocked(getToken);
const trackMock = vi.mocked(track);

const ok = (
  reply: string,
  over: Partial<{
    intent: Intent;
    offerCallback: boolean;
    readyToConfirm: boolean;
    lead: Partial<LeadDraft>;
  }> = {}
): ChatResult => ({
  kind: 'ok',
  data: {
    reply,
    intent: over.intent ?? 'answer',
    offerCallback: over.offerCallback ?? false,
    readyToConfirm: over.readyToConfirm ?? false,
    lead: { ...EMPTY_LEAD_DRAFT, ...over.lead },
  },
});

const setup = () => renderHook(() => useConcierge());

const open = async (
  result: ReturnType<typeof setup>['result'],
  detail: OpenDetail = { source: 'bubble' }
) => {
  await act(async () => {
    await result.current.handleOpen(detail);
  });
};

const send = async (result: ReturnType<typeof setup>['result'], text: string) => {
  await act(async () => {
    await result.current.send(text);
  });
};

const leadInput = {
  name: 'Jane Doe',
  phone: '7705551234',
  business: 'Doe Plumbing',
  callbackWindow: 'midday_11_1' as const,
  consent: true as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  getTokenMock.mockResolvedValue(null);
  postChatMock.mockResolvedValue(ok('Default reply.'));
});

describe('isHandoffRequest', () => {
  it('matches asks for a person', () => {
    for (const t of [
      'Can I talk to a person?',
      'i want to speak with a human',
      'chat with someone real please',
      'talk to a representative',
      'I need a real person',
    ]) {
      expect(isHandoffRequest(t), t).toBe(true);
    }
  });

  it('ignores ordinary questions', () => {
    for (const t of ['What do you do?', 'Do you talk to customers?', 'person of interest']) {
      expect(isHandoffRequest(t), t).toBe(false);
    }
  });
});

describe('useConcierge: opening', () => {
  it('pushes the local greeting and shows the chips on first open, without any network call', async () => {
    const { result } = setup();
    await open(result);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      role: 'assistant',
      content: copy.GREETING,
      greeting: true,
    });
    expect(result.current.chips).toEqual(copy.CHIPS);
    expect(postChatMock).not.toHaveBeenCalled();
  });

  it('does not push a second greeting on a later open', async () => {
    const { result } = setup();
    await open(result);
    await open(result);
    expect(result.current.messages).toHaveLength(1);
  });

  it('runs a quickReply as a chip click once the greeting is there', async () => {
    const { result } = setup();
    await open(result, { source: 'section_cta', quickReply: 'Try the AI Concierge' });
    expect(result.current.messages.map((m) => m.role)).toEqual([
      'assistant',
      'user',
      'assistant',
    ]);
    expect(result.current.messages[1].content).toBe('Try the AI Concierge');
    expect(trackMock).toHaveBeenCalledWith('concierge_quick_reply', {
      chip: 'Try the AI Concierge',
    });
    expect(postChatMock).toHaveBeenCalledTimes(1);
  });
});

describe('useConcierge: chips', () => {
  it('"What do you do?" sends its text as a user message and tracks the chip', async () => {
    const { result } = setup();
    await open(result);
    await act(async () => {
      await result.current.chip('What do you do?');
    });
    expect(trackMock).toHaveBeenCalledWith('concierge_quick_reply', {
      chip: 'What do you do?',
    });
    expect(result.current.messages.at(-2)).toMatchObject({
      role: 'user',
      content: 'What do you do?',
    });
    expect(result.current.chips).toEqual([]);
  });

  it('passes only the widget\'s own chip labels to analytics', async () => {
    const { result } = setup();
    await open(result);
    await act(async () => {
      await result.current.chip('my number is 770-555-1234');
    });
    expect(trackMock).toHaveBeenCalledWith('concierge_quick_reply', undefined);
    expect(trackMock).not.toHaveBeenCalledWith(
      'concierge_quick_reply',
      expect.objectContaining({ chip: expect.stringContaining('770') })
    );
  });

  it('"Request a callback" shows the intro and the form with no network call', async () => {
    const { result } = setup();
    await open(result);
    await act(async () => {
      await result.current.chip('Request a callback');
    });
    expect(postChatMock).not.toHaveBeenCalled();
    expect(result.current.showLeadForm).toBe(true);
    expect(result.current.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: copy.CALLBACK_INTRO,
    });
    expect(trackMock).toHaveBeenCalledWith('concierge_lead_form_shown');
    expect(trackMock).toHaveBeenCalledWith('concierge_quick_reply', {
      chip: 'Request a callback',
    });
    expect(result.current.chips).toEqual([]);
  });
});

describe('useConcierge: sending', () => {
  it('appends the user message, marks sending, then appends the reply', async () => {
    let release: (r: ChatResult) => void = () => {};
    postChatMock.mockImplementation(
      () => new Promise<ChatResult>((resolve) => (release = resolve))
    );
    const { result } = setup();
    await open(result);

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.send('  How do you help?  ');
    });
    expect(result.current.status).toBe('sending');
    expect(result.current.turn).toBe(1);
    expect(result.current.messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'How do you help?',
    });
    expect(trackMock).toHaveBeenCalledWith('concierge_message_sent', { turn_number: 1 });

    await act(async () => {
      release(ok('We save you time.'));
      await pending;
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'We save you time.',
    });
  });

  it('sends the visible thread minus the greeting, ending with the user turn', async () => {
    const { result } = setup();
    await open(result);
    await send(result, 'First question');
    await send(result, 'Second question');
    const req = postChatMock.mock.calls[1][0];
    expect(req.sessionId).toBe(result.current.sessionId);
    expect(req.turnstileToken).toBeUndefined();
    expect(req.messages).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'Default reply.' },
      { role: 'user', content: 'Second question' },
    ]);
  });

  it('ignores a second send while the first is still waiting for its reply', async () => {
    let release: (r: ChatResult) => void = () => {};
    postChatMock.mockImplementation(
      () => new Promise<ChatResult>((resolve) => (release = resolve))
    );
    const { result } = setup();
    await open(result);

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.send('first');
    });
    expect(result.current.status).toBe('sending');
    await act(async () => {
      await result.current.send('second');
    });
    expect(postChatMock).toHaveBeenCalledTimes(1);
    expect(result.current.turn).toBe(1);
    expect(result.current.messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
      'first',
    ]);

    await act(async () => {
      release(ok('done'));
      await first;
    });
    expect(result.current.status).toBe('idle');
  });

  it('ignores empty input', async () => {
    const { result } = setup();
    await open(result);
    await send(result, '   ');
    expect(postChatMock).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(1);
  });

  it('refuses a message over 1,000 characters and shows TOO_LONG inline', async () => {
    const { result } = setup();
    await open(result);
    await send(result, 'x'.repeat(1001));
    expect(postChatMock).not.toHaveBeenCalled();
    expect(result.current.composerError).toBe(copy.TOO_LONG);
    expect(result.current.messages).toHaveLength(1);
    act(() => result.current.clearComposerError());
    expect(result.current.composerError).toBeNull();
  });

  it('accepts exactly 1,000 characters', async () => {
    const { result } = setup();
    await open(result);
    await send(result, 'x'.repeat(1000));
    expect(postChatMock).toHaveBeenCalledTimes(1);
  });

  it('answers a request for a person locally, with a call link and no network', async () => {
    const { result } = setup();
    await open(result);
    await send(result, 'Can I talk to a real person?');
    expect(postChatMock).not.toHaveBeenCalled();
    expect(result.current.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: copy.HANDOFF,
      callLink: true,
    });
    expect(result.current.turn).toBe(0);
    expect(trackMock).not.toHaveBeenCalledWith('concierge_message_sent', expect.anything());
  });
});

describe('toChatTurns', () => {
  const m = (role: Message['role'], content: string, extra: Partial<Message> = {}): Message => ({
    id: content,
    role,
    content,
    at: '2026-11-03T15:00:00.000Z',
    ...extra,
  });

  it('drops the greeting and keeps only role and content', () => {
    expect(
      toChatTurns([m('assistant', 'hi', { greeting: true }), m('user', 'q', { callLink: true })])
    ).toEqual([{ role: 'user', content: 'q' }]);
  });

  it('keeps the last 25 entries and never starts on an assistant entry', () => {
    // 30 entries: u0 a0 u1 a1 ... so entry 5 (the cut point for the last 25) is an assistant.
    const thread = Array.from({ length: 30 }, (_, i) =>
      m(i % 2 === 0 ? 'user' : 'assistant', `e${i}`)
    );
    const turns = toChatTurns(thread);
    expect(turns).toHaveLength(24);
    expect(turns[0]).toEqual({ role: 'user', content: 'e6' });
    expect(turns.at(-1)).toEqual({ role: 'assistant', content: 'e29' });
  });

  it('clamps long entries to 1,000 characters', () => {
    expect(toChatTurns([m('user', 'x'.repeat(1200))])[0].content).toHaveLength(1000);
  });
});

describe('useConcierge: responses', () => {
  it('shows the offer chips when the reply asks for a callback, and "Yes, call me" opens the form', async () => {
    postChatMock.mockResolvedValue(ok('Want me to have someone call you?', { offerCallback: true }));
    const { result } = setup();
    await open(result);
    await send(result, 'How do I get started?');
    expect(result.current.chips).toEqual(copy.OFFER_CHIPS);

    await act(async () => {
      await result.current.chip('Yes, call me');
    });
    expect(result.current.showLeadForm).toBe(true);
    expect(result.current.messages.at(-1)?.content).toBe(copy.CALLBACK_INTRO);
    expect(result.current.chips).toEqual([]);
    expect(trackMock).toHaveBeenCalledWith('concierge_lead_form_shown');
  });

  it('"No thanks" just clears the chips', async () => {
    postChatMock.mockResolvedValue(ok('Want a call?', { offerCallback: true }));
    const { result } = setup();
    await open(result);
    await send(result, 'quote please');
    const before = result.current.messages.length;
    await act(async () => {
      await result.current.chip('No thanks');
    });
    expect(result.current.chips).toEqual([]);
    expect(result.current.showLeadForm).toBe(false);
    expect(result.current.messages).toHaveLength(before);
  });

  it('renders a handoff reply with a call link', async () => {
    postChatMock.mockResolvedValue(ok('Call (866) 519-7993.', { intent: 'handoff' }));
    const { result } = setup();
    await open(result);
    await send(result, 'someone to talk to');
    expect(result.current.messages.at(-1)).toMatchObject({ callLink: true });
  });

  it('tracks off_topic replies', async () => {
    postChatMock.mockResolvedValue(ok('Just here for THG.', { intent: 'off_topic' }));
    const { result } = setup();
    await open(result);
    await send(result, 'what is the weather');
    expect(trackMock).toHaveBeenCalledWith('concierge_off_topic');
  });

  it('429 pushes RATE_LIMITED and tracks it', async () => {
    postChatMock.mockResolvedValue({ kind: 'rate_limited' });
    const { result } = setup();
    await open(result);
    await send(result, 'hi');
    expect(result.current.messages.at(-1)?.content).toBe(copy.RATE_LIMITED);
    expect(trackMock).toHaveBeenCalledWith('concierge_rate_limited');
    expect(result.current.status).toBe('idle');
  });

  it('prefers the server reply text when one is provided', async () => {
    postChatMock.mockResolvedValue({ kind: 'rate_limited', reply: 'Server says call us.' });
    const { result } = setup();
    await open(result);
    await send(result, 'hi');
    expect(result.current.messages.at(-1)?.content).toBe('Server says call us.');
  });

  it('503 pushes LEAD_ONLY, goes lead-only and shows the form', async () => {
    postChatMock.mockResolvedValue({ kind: 'lead_only' });
    const { result } = setup();
    await open(result);
    await send(result, 'hi');
    expect(result.current.messages.at(-1)?.content).toBe(copy.LEAD_ONLY);
    expect(result.current.status).toBe('leadOnly');
    expect(result.current.showLeadForm).toBe(true);
    expect(trackMock).toHaveBeenCalledWith('concierge_lead_form_shown');
  });

  it('403 ended pushes ENDED and disables further sends', async () => {
    postChatMock.mockResolvedValue({ kind: 'ended' });
    const { result } = setup();
    await open(result);
    await send(result, 'rude words');
    expect(result.current.messages.at(-1)?.content).toBe(copy.ENDED);
    expect(result.current.status).toBe('ended');
    postChatMock.mockClear();
    await send(result, 'hello again');
    expect(postChatMock).not.toHaveBeenCalled();
  });

  it('a server message_too_long shows the server text, or TOO_LONG, and returns to idle', async () => {
    postChatMock.mockResolvedValueOnce({ kind: 'too_long', reply: 'Please shorten that.' });
    const { result } = setup();
    await open(result);
    await send(result, 'long-ish');
    expect(result.current.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Please shorten that.',
    });
    expect(result.current.status).toBe('idle');

    postChatMock.mockResolvedValueOnce({ kind: 'too_long' });
    await send(result, 'still long-ish');
    expect(result.current.messages.at(-1)?.content).toBe(copy.TOO_LONG);
    expect(result.current.status).toBe('idle');
  });

  it('network and server errors push ERROR and return to idle', async () => {
    postChatMock.mockResolvedValue({ kind: 'error', reason: 'network' });
    const { result } = setup();
    await open(result);
    await send(result, 'hi');
    expect(result.current.messages.at(-1)?.content).toBe(copy.ERROR);
    expect(result.current.status).toBe('idle');
  });
});

describe('useConcierge: Turnstile', () => {
  it('requests no token for the first 10 messages and one from the 11th on', async () => {
    getTokenMock.mockResolvedValue('tok-11');
    const { result } = setup();
    await open(result);
    for (let i = 1; i <= 10; i += 1) await send(result, `m${i}`);
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(postChatMock.mock.calls[9][0].turnstileToken).toBeUndefined();

    await send(result, 'm11');
    expect(getTokenMock).toHaveBeenCalledTimes(1);
    expect(postChatMock.mock.calls[10][0].turnstileToken).toBe('tok-11');
    expect(result.current.turn).toBe(11);
  });

  it('on verification_required fetches a token and retries once', async () => {
    postChatMock
      .mockResolvedValueOnce({ kind: 'verification_required' })
      .mockResolvedValueOnce(ok('Now it works.'));
    getTokenMock.mockResolvedValue('fresh');
    const { result } = setup();
    await open(result);
    await send(result, 'hi');
    expect(postChatMock).toHaveBeenCalledTimes(2);
    expect(postChatMock.mock.calls[1][0].turnstileToken).toBe('fresh');
    expect(result.current.messages.at(-1)?.content).toBe('Now it works.');
  });

  it('shows ERROR if the retry also demands verification', async () => {
    postChatMock.mockResolvedValue({ kind: 'verification_required' });
    getTokenMock.mockResolvedValue('fresh');
    const { result } = setup();
    await open(result);
    await send(result, 'hi');
    expect(postChatMock).toHaveBeenCalledTimes(2);
    expect(result.current.messages.at(-1)?.content).toBe(copy.ERROR);
  });

  it('shows ERROR without retrying when no token can be obtained', async () => {
    postChatMock.mockResolvedValue({ kind: 'verification_required' });
    getTokenMock.mockResolvedValue(null);
    const { result } = setup();
    await open(result);
    await send(result, 'hi');
    expect(postChatMock).toHaveBeenCalledTimes(1);
    expect(result.current.messages.at(-1)?.content).toBe(copy.ERROR);
  });
});

describe('useConcierge: lead submit', () => {
  it('posts the transcript, page and UTM, then replaces the form with the confirmation', async () => {
    window.history.replaceState({}, '', '/?utm_source=google&x=1#ai-concierge');
    postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
    getTokenMock.mockResolvedValue('lead-token');
    const { result } = setup();
    await open(result);
    await send(result, 'What do you do?');
    await act(async () => {
      await result.current.chip('Request a callback');
    });

    let outcome: Awaited<ReturnType<typeof result.current.submitLead>> | undefined;
    await act(async () => {
      outcome = await result.current.submitLead(leadInput);
    });

    expect(outcome).toEqual({ ok: true });
    expect(postLeadMock).toHaveBeenCalledTimes(1);
    const req = postLeadMock.mock.calls[0][0];
    expect(req).toMatchObject({
      sessionId: result.current.sessionId,
      ...leadInput,
      turnstileToken: 'lead-token',
      page: { url: window.location.href, utm: { utm_source: 'google' } },
    });
    expect(req.transcript.map((t) => t.content)).toEqual([
      'What do you do?',
      'Default reply.',
      'Request a callback',
      copy.CALLBACK_INTRO,
    ]);
    expect(req.transcript.every((t) => typeof t.at === 'string' && t.at.length > 0)).toBe(true);

    expect(trackMock).toHaveBeenCalledWith('concierge_lead_submitted', {
      callback_window: 'midday_11_1',
      delivery: 'email',
    });
    // The GA4 key event: no params at all, so no lead details can leak into it.
    expect(trackMock).toHaveBeenCalledWith('concierge_lead');
    expect(trackMock.mock.calls.filter(([name]) => name === 'concierge_lead')).toHaveLength(1);
    expect(trackMock.mock.calls.find(([name]) => name === 'concierge_lead')).toEqual(['concierge_lead']);
    expect(result.current.showLeadForm).toBe(false);
    expect(result.current.leadDone).toBe(true);
    expect(result.current.messages.at(-1)?.content).toBe(
      copy.CONFIRM('Jane', copy.WINDOWS.midday_11_1)
    );
  });

  it('clamps page.url to 500 characters', async () => {
    window.history.replaceState({}, '', `/?q=${'a'.repeat(800)}#ai-concierge`);
    expect(window.location.href.length).toBeGreaterThan(500);
    postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
    const { result } = setup();
    await open(result);
    await act(async () => {
      await result.current.submitLead(leadInput);
    });
    const url = postLeadMock.mock.calls[0][0].page.url;
    expect(url).toHaveLength(500);
    expect(url).toBe(window.location.href.slice(0, 500));
  });

  it('works in lead-only mode and stays lead-only afterwards', async () => {
    postChatMock.mockResolvedValue({ kind: 'lead_only' });
    postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'leadquik' });
    const { result } = setup();
    await open(result);
    await send(result, 'hi');
    await act(async () => {
      await result.current.submitLead(leadInput);
    });
    expect(result.current.status).toBe('leadOnly');
    expect(result.current.leadDone).toBe(true);
    expect(result.current.showLeadForm).toBe(false);
  });

  it('maps a 400 onto field errors and keeps the form open', async () => {
    postLeadMock.mockResolvedValue({
      kind: 'validation',
      fields: { phone: 'Enter a 10-digit US phone number' },
    } satisfies LeadResult);
    const { result } = setup();
    await open(result);
    await act(async () => {
      await result.current.chip('Request a callback');
    });
    let outcome: Awaited<ReturnType<typeof result.current.submitLead>> | undefined;
    await act(async () => {
      outcome = await result.current.submitLead(leadInput);
    });
    expect(outcome).toEqual({
      ok: false,
      fields: { phone: 'Enter a 10-digit US phone number' },
    });
    expect(result.current.showLeadForm).toBe(true);
    expect(result.current.leadDone).toBe(false);
    expect(trackMock).not.toHaveBeenCalledWith('concierge_lead_failed');
  });

  it('a 400 about a field the form does not have becomes a notice with the server message', async () => {
    postLeadMock.mockResolvedValue({
      kind: 'validation',
      fields: { sessionId: 'Invalid session id', transcript: 'Too many entries' },
    });
    const { result } = setup();
    await open(result);
    await act(async () => {
      await result.current.chip('Request a callback');
    });
    let outcome: Awaited<ReturnType<typeof result.current.submitLead>> | undefined;
    await act(async () => {
      outcome = await result.current.submitLead(leadInput);
    });
    expect(outcome).toEqual({ ok: false });
    expect(result.current.leadError).toBe(true);
    expect(result.current.leadErrorMessage).toBe('Invalid session id');
    expect(result.current.showLeadForm).toBe(true);
    expect(trackMock).toHaveBeenCalledWith('concierge_lead_failed');
  });

  it('a 400 with an empty fields object falls back to the default delivery-failed notice', async () => {
    postLeadMock.mockResolvedValue({ kind: 'validation', fields: {} });
    const { result } = setup();
    await open(result);
    await act(async () => {
      await result.current.chip('Request a callback');
    });
    let outcome: Awaited<ReturnType<typeof result.current.submitLead>> | undefined;
    await act(async () => {
      outcome = await result.current.submitLead(leadInput);
    });
    expect(outcome).toEqual({ ok: false });
    expect(result.current.leadError).toBe(true);
    expect(result.current.leadErrorMessage).toBeNull();
  });

  it('a 400 that names a rendered field plus an unknown one maps only the rendered field', async () => {
    postLeadMock.mockResolvedValue({
      kind: 'validation',
      fields: { phone: 'Enter a 10-digit US phone number', page: 'Bad page' },
    });
    const { result } = setup();
    await open(result);
    await act(async () => {
      await result.current.chip('Request a callback');
    });
    let outcome: Awaited<ReturnType<typeof result.current.submitLead>> | undefined;
    await act(async () => {
      outcome = await result.current.submitLead(leadInput);
    });
    expect(outcome).toEqual({ ok: false, fields: { phone: 'Enter a 10-digit US phone number' } });
    expect(result.current.leadError).toBe(false);
  });

  it('clears the previous failure message when the visitor tries again', async () => {
    postLeadMock.mockResolvedValueOnce({ kind: 'validation', fields: { page: 'Bad page' } });
    postLeadMock.mockResolvedValueOnce({ kind: 'delivery_failed' });
    const { result } = setup();
    await open(result);
    await act(async () => {
      await result.current.chip('Request a callback');
    });
    await act(async () => {
      await result.current.submitLead(leadInput);
    });
    expect(result.current.leadErrorMessage).toBe('Bad page');
    await act(async () => {
      await result.current.submitLead(leadInput);
    });
    expect(result.current.leadError).toBe(true);
    expect(result.current.leadErrorMessage).toBeNull();
  });

  it('on a delivery failure tracks it, flags the error, and keeps the form', async () => {
    postLeadMock.mockResolvedValue({ kind: 'delivery_failed' });
    const { result } = setup();
    await open(result);
    await act(async () => {
      await result.current.chip('Request a callback');
    });
    await act(async () => {
      await result.current.submitLead(leadInput);
    });
    expect(trackMock).toHaveBeenCalledWith('concierge_lead_failed');
    expect(trackMock).not.toHaveBeenCalledWith('concierge_lead');
    expect(result.current.leadError).toBe(true);
    expect(result.current.showLeadForm).toBe(true);
    expect(result.current.leadDone).toBe(false);
    expect(result.current.leadSending).toBe(false);
  });

  it('treats a network error like a delivery failure, and clears the flag on retry', async () => {
    postLeadMock.mockResolvedValueOnce({ kind: 'error', reason: 'network' });
    postLeadMock.mockResolvedValueOnce({ kind: 'ok', delivery: 'email' });
    const { result } = setup();
    await open(result);
    await act(async () => {
      await result.current.chip('Request a callback');
    });
    await act(async () => {
      await result.current.submitLead(leadInput);
    });
    expect(result.current.leadError).toBe(true);
    await act(async () => {
      await result.current.submitLead(leadInput);
    });
    expect(result.current.leadError).toBe(false);
    expect(result.current.leadDone).toBe(true);
  });
});

describe('useConcierge: conversational lead capture (plan v1.1)', () => {
  const formShownCount = () =>
    trackMock.mock.calls.filter(([name]) => name === 'concierge_lead_form_shown').length;

  const dana = { name: 'Dana Lee' };
  const danaWithPhone = { name: 'Dana Lee', phone: '7705550147' };

  it('shows a collecting reply like an answer: no form, no extra tracking', async () => {
    postChatMock.mockResolvedValue(
      ok('Thanks! What is the best number to reach you?', { intent: 'collecting', lead: dana })
    );
    const { result } = setup();
    await open(result);
    trackMock.mockClear();
    await send(result, 'can you have someone call me?');
    expect(result.current.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Thanks! What is the best number to reach you?',
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.showLeadForm).toBe(false);
    expect(trackMock.mock.calls.map(([name]) => name)).toEqual(['concierge_message_sent']);
  });

  it('remembers partial lead details across replies without ever dropping one', async () => {
    postChatMock
      .mockResolvedValueOnce(ok('Thanks Dana. And your number?', { intent: 'collecting', lead: dana }))
      .mockResolvedValueOnce(
        ok('Got it. Which business is this for?', {
          intent: 'collecting',
          lead: { phone: '7705550147' }, // name left empty in this reply
        })
      );
    const { result } = setup();
    await open(result);
    expect(result.current.gatheredLead).toEqual(EMPTY_LEAD_DRAFT);
    await send(result, 'Dana Lee');
    expect(result.current.gatheredLead).toEqual({ ...EMPTY_LEAD_DRAFT, name: 'Dana Lee' });
    await send(result, '770-555-0147');
    expect(result.current.gatheredLead).toEqual({ ...EMPTY_LEAD_DRAFT, ...danaWithPhone });
  });

  it('readyToConfirm opens the lead form under the reply, pre-filled, with the heading', async () => {
    postChatMock.mockResolvedValue(
      ok("Here's what I've got. Check the box below and tap send.", {
        intent: 'collecting',
        readyToConfirm: true,
        lead: { ...danaWithPhone, business: 'Lee Landscaping', callbackWindow: 'afternoon_1_3' },
      })
    );
    const { result } = setup();
    await open(result);
    await send(result, '770-555-0147');

    expect(result.current.showLeadForm).toBe(true);
    expect(result.current.leadHeading).toBe(copy.LEAD_FORM_HEADING);
    expect(result.current.gatheredLead).toEqual({
      ...EMPTY_LEAD_DRAFT,
      ...danaWithPhone,
      business: 'Lee Landscaping',
      callbackWindow: 'afternoon_1_3',
    });
    // The reply stays the last message, so the form sits directly beneath it.
    expect(result.current.messages.at(-1)?.content).toBe(
      "Here's what I've got. Check the box below and tap send."
    );
    expect(result.current.status).toBe('idle');
    expect(result.current.chips).toEqual([]);
  });

  it('tracks concierge_lead_form_shown once for that appearance, even if another ready reply follows', async () => {
    postChatMock.mockResolvedValue(
      ok('Ready.', { intent: 'collecting', readyToConfirm: true, lead: danaWithPhone })
    );
    const { result } = setup();
    await open(result);
    await send(result, 'my number is 770-555-0147');
    expect(formShownCount()).toBe(1);
    await send(result, 'one more thing');
    expect(result.current.showLeadForm).toBe(true);
    expect(formShownCount()).toBe(1);
  });

  it('does not show the form for readyToConfirm once a lead was already submitted', async () => {
    postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
    const { result } = setup();
    await open(result);
    await act(async () => {
      await result.current.chip('Request a callback');
    });
    await act(async () => {
      await result.current.submitLead(leadInput);
    });
    expect(result.current.leadDone).toBe(true);
    trackMock.mockClear();

    postChatMock.mockResolvedValue(
      ok('Ready again.', { intent: 'collecting', readyToConfirm: true, lead: danaWithPhone })
    );
    await send(result, 'my number is 770-555-0147');
    expect(result.current.showLeadForm).toBe(false);
    expect(formShownCount()).toBe(0);
  });

  it('keeps the form from a ready reply out of the offer chips, but still offers them for a plain callback offer', async () => {
    postChatMock.mockResolvedValueOnce(
      ok('Here you go.', { intent: 'collecting', readyToConfirm: true, offerCallback: true, lead: danaWithPhone })
    );
    const { result } = setup();
    await open(result);
    await send(result, 'hi');
    expect(result.current.showLeadForm).toBe(true);
    expect(result.current.chips).toEqual([]); // the form is already showing

    window.sessionStorage.clear(); // a brand-new visitor: the first one's open form must not be resumed
    const second = setup();
    postChatMock.mockResolvedValueOnce(ok('Want me to have someone call you?', { offerCallback: true }));
    await open(second.result);
    await send(second.result, 'how do I get started');
    expect(second.result.current.showLeadForm).toBe(false);
    expect(second.result.current.chips).toEqual(copy.OFFER_CHIPS);
  });

  it('"Yes, call me" after partial data opens the form pre-filled, without the ready heading', async () => {
    postChatMock
      .mockResolvedValueOnce(ok('Thanks Dana. Want me to have someone call you?', {
        intent: 'collecting',
        offerCallback: true,
        lead: { ...dana, business: 'Lee Landscaping' },
      }));
    const { result } = setup();
    await open(result);
    await send(result, "I'm Dana Lee from Lee Landscaping, how much does this cost");
    expect(result.current.chips).toEqual(copy.OFFER_CHIPS);
    expect(result.current.showLeadForm).toBe(false);

    await act(async () => {
      await result.current.chip('Yes, call me');
    });
    expect(result.current.showLeadForm).toBe(true);
    expect(result.current.leadHeading).toBeNull();
    expect(result.current.gatheredLead).toEqual({ ...EMPTY_LEAD_DRAFT, ...dana, business: 'Lee Landscaping' });
    expect(result.current.messages.at(-1)?.content).toBe(copy.CALLBACK_INTRO);
    expect(formShownCount()).toBe(1);
  });

  it('"Request a callback" after partial data pre-fills too', async () => {
    postChatMock.mockResolvedValueOnce(ok('Nice to meet you.', { intent: 'collecting', lead: dana }));
    const { result } = setup();
    await open(result);
    await send(result, "I'm Dana Lee");
    await act(async () => {
      await result.current.chip('Request a callback');
    });
    expect(result.current.showLeadForm).toBe(true);
    expect(result.current.gatheredLead.name).toBe('Dana Lee');
  });

  it('the lead-only fallback form is pre-filled with whatever was gathered before the outage', async () => {
    postChatMock
      .mockResolvedValueOnce(ok('Thanks Dana.', { intent: 'collecting', lead: dana }))
      .mockResolvedValueOnce({ kind: 'lead_only' });
    const { result } = setup();
    await open(result);
    await send(result, "I'm Dana Lee");
    await send(result, 'my number is 770-555-0147');
    expect(result.current.status).toBe('leadOnly');
    expect(result.current.showLeadForm).toBe(true);
    expect(result.current.gatheredLead.name).toBe('Dana Lee');
    expect(result.current.leadHeading).toBeNull();
  });

  it('shows the confirmation and drops the form and heading after a successful send', async () => {
    postChatMock.mockResolvedValue(
      ok('Ready.', { intent: 'collecting', readyToConfirm: true, lead: danaWithPhone })
    );
    postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
    const { result } = setup();
    await open(result);
    await send(result, 'my number is 770-555-0147');
    expect(result.current.leadHeading).toBe(copy.LEAD_FORM_HEADING);
    await act(async () => {
      await result.current.submitLead({ ...leadInput, name: 'Dana Lee', phone: '7705550147' });
    });
    expect(result.current.showLeadForm).toBe(false);
    expect(result.current.leadHeading).toBeNull();
    expect(result.current.leadDone).toBe(true);
    expect(result.current.messages.at(-1)?.content).toBe(
      copy.CONFIRM('Dana', copy.WINDOWS.midday_11_1)
    );
  });

  describe('dismissing the form ("Not now, keep chatting")', () => {
    const readyThenDismiss = async () => {
      postChatMock.mockResolvedValueOnce(
        ok("Here's what I've got.", {
          intent: 'collecting',
          readyToConfirm: true,
          lead: { ...danaWithPhone, business: 'Lee Landscaping' },
        })
      );
      const hook = setup();
      await open(hook.result);
      await send(hook.result, "Dana Lee, 770-555-0147");
      expect(hook.result.current.showLeadForm).toBe(true);
      trackMock.mockClear();
      act(() => hook.result.current.dismissLeadForm());
      return hook;
    };

    it('hides the form and its heading, back to a normal idle chat with no error', async () => {
      const { result } = await readyThenDismiss();
      expect(result.current.showLeadForm).toBe(false);
      expect(result.current.leadHeading).toBeNull();
      expect(result.current.status).toBe('idle');
      expect(result.current.leadError).toBe(false);
      expect(result.current.leadErrorMessage).toBeNull();
      expect(result.current.composerError).toBeNull();
      expect(result.current.leadDone).toBe(false);
    });

    it('keeps what the helper gathered, and the thread as it was', async () => {
      const { result } = await readyThenDismiss();
      expect(result.current.gatheredLead).toEqual({
        ...EMPTY_LEAD_DRAFT,
        ...danaWithPhone,
        business: 'Lee Landscaping',
      });
      expect(result.current.messages.at(-1)?.content).toBe("Here's what I've got.");
    });

    it('fires no analytics event', async () => {
      await readyThenDismiss();
      expect(trackMock).not.toHaveBeenCalled();
    });

    it('lets the visitor chat on', async () => {
      const { result } = await readyThenDismiss();
      postChatMock.mockResolvedValueOnce(ok('Sure, ask away.'));
      await send(result, 'actually, one more question');
      expect(result.current.messages.at(-1)?.content).toBe('Sure, ask away.');
      expect(postChatMock).toHaveBeenCalledTimes(2);
    });

    it('a later "Yes, call me" opens the form pre-filled again, as a new appearance', async () => {
      const { result } = await readyThenDismiss();
      postChatMock.mockResolvedValueOnce(ok('Want me to have someone call you?', { offerCallback: true }));
      await send(result, 'what does it cost');
      expect(result.current.chips).toEqual(copy.OFFER_CHIPS);
      trackMock.mockClear();
      await act(async () => {
        await result.current.chip('Yes, call me');
      });
      expect(result.current.showLeadForm).toBe(true);
      expect(result.current.gatheredLead).toMatchObject({ ...danaWithPhone, business: 'Lee Landscaping' });
      expect(trackMock.mock.calls.filter(([n]) => n === 'concierge_lead_form_shown')).toHaveLength(1);
    });

    describe('after a dismissal, readyToConfirm re-opens the form only when a missing detail gets filled', () => {
      const GATHERED = { ...danaWithPhone, business: 'Lee Landscaping' };

      it('the same details again: the reply shows normally and the form stays closed', async () => {
        const { result } = await readyThenDismiss();
        postChatMock.mockResolvedValueOnce(
          ok('Happy to explain call handling.', { intent: 'collecting', readyToConfirm: true, lead: GATHERED })
        );
        trackMock.mockClear();
        await send(result, 'what does call handling do?');
        expect(result.current.messages.at(-1)?.content).toBe('Happy to explain call handling.');
        expect(result.current.showLeadForm).toBe(false);
        expect(result.current.leadHeading).toBeNull();
        expect(result.current.status).toBe('idle');
        expect(trackMock.mock.calls.filter(([n]) => n === 'concierge_lead_form_shown')).toHaveLength(0);
        // The visitor is not stranded if they now say "ok, go ahead": a one-tap way back to the form.
        expect(result.current.chips).toEqual([copy.OFFER_YES]);
      });

      it('"ok, go ahead and call me" after a dismissal: the reply points at a box that is gone, so a Yes, call me chip opens it', async () => {
        const { result } = await readyThenDismiss();
        postChatMock.mockResolvedValueOnce(
          ok("Great. Check the box below and tap send.", { intent: 'collecting', readyToConfirm: true, lead: GATHERED })
        );
        await send(result, 'ok, go ahead and call me');
        expect(result.current.showLeadForm).toBe(false);
        expect(result.current.chips).toEqual([copy.OFFER_YES]);

        trackMock.mockClear();
        await act(async () => {
          await result.current.chip('Yes, call me');
        });
        expect(result.current.showLeadForm).toBe(true);
        expect(result.current.leadHeading).toBeNull(); // the visitor asked, so no "here's what I have"
        expect(result.current.gatheredLead).toEqual({ ...EMPTY_LEAD_DRAFT, ...GATHERED });
        expect(result.current.messages.at(-1)?.content).toBe(copy.CALLBACK_INTRO);
        expect(result.current.messages.at(-2)).toMatchObject({ role: 'user', content: 'Yes, call me' });
        expect(result.current.chips).toEqual([]);
        expect(trackMock.mock.calls.filter(([n]) => n === 'concierge_lead_form_shown')).toHaveLength(1);
      });

      it('keeps both chips when the same reply also offers a callback', async () => {
        const { result } = await readyThenDismiss();
        postChatMock.mockResolvedValueOnce(
          ok('Want me to have someone call you?', { offerCallback: true, readyToConfirm: true, lead: GATHERED })
        );
        await send(result, 'hmm');
        expect(result.current.chips).toEqual(copy.OFFER_CHIPS);
      });

      it('shows no chip when nothing is pending: not ready, or the form is already up, or the lead was sent', async () => {
        const plain = setup();
        postChatMock.mockResolvedValueOnce(ok('Just an answer.'));
        await open(plain.result);
        await send(plain.result, 'hello');
        expect(plain.result.current.chips).toEqual([]);

        const first = setup();
        postChatMock.mockResolvedValueOnce(
          ok('Ready.', { intent: 'collecting', readyToConfirm: true, lead: GATHERED })
        );
        await open(first.result);
        await send(first.result, 'Dana Lee, 770-555-0147');
        expect(first.result.current.showLeadForm).toBe(true);
        expect(first.result.current.chips).toEqual([]);
      });

      it('a reply that repeats only some of the details, or none, does not re-open it either', async () => {
        const { result } = await readyThenDismiss();
        postChatMock
          .mockResolvedValueOnce(ok('One.', { intent: 'collecting', readyToConfirm: true, lead: danaWithPhone }))
          .mockResolvedValueOnce(ok('Two.', { intent: 'collecting', readyToConfirm: true, lead: {} }));
        await send(result, 'first');
        await send(result, 'second');
        expect(result.current.showLeadForm).toBe(false);
        expect(result.current.gatheredLead).toEqual({ ...EMPTY_LEAD_DRAFT, ...GATHERED });
        expect(result.current.chips).toEqual([copy.OFFER_YES]);
      });

      it('a changed phone number does not re-open it: the reply shows normally and a chip offers the form', async () => {
        const { result } = await readyThenDismiss();
        postChatMock.mockResolvedValueOnce(
          ok('Got the new number.', {
            intent: 'collecting',
            readyToConfirm: true,
            lead: { ...GATHERED, phone: '4045550100' },
          })
        );
        trackMock.mockClear();
        await send(result, 'use 404-555-0100 instead');
        expect(result.current.showLeadForm).toBe(false);
        expect(result.current.chips).toEqual([copy.OFFER_YES]);
        expect(trackMock.mock.calls.filter(([n]) => n === 'concierge_lead_form_shown')).toHaveLength(0);
        // The new number is not lost: the chip (or "Request a callback") opens the form with it.
        expect(result.current.gatheredLead.phone).toBe('4045550100');
        await act(async () => {
          await result.current.chip('Yes, call me');
        });
        expect(result.current.showLeadForm).toBe(true);
        expect(result.current.gatheredLead).toEqual({ ...EMPTY_LEAD_DRAFT, ...GATHERED, phone: '4045550100' });
      });

      it('a reworded need does not re-open it, but the latest wording is kept for when the form opens', async () => {
        const { result } = await readyThenDismiss();
        postChatMock
          .mockResolvedValueOnce(
            ok('Happy to explain.', { intent: 'collecting', readyToConfirm: true, lead: { ...GATHERED, need: 'missed calls' } })
          )
          .mockResolvedValueOnce(
            ok('Sure.', {
              intent: 'collecting',
              readyToConfirm: true,
              lead: { ...GATHERED, need: 'answering the phone after hours' },
            })
          );
        await send(result, 'What does working with you look like?');
        await send(result, 'and how do calls work?');
        expect(result.current.showLeadForm).toBe(false);
        expect(result.current.chips).toEqual([copy.OFFER_YES]);
        expect(result.current.gatheredLead.need).toBe('answering the phone after hours');
        await act(async () => {
          await result.current.chip('Yes, call me');
        });
        expect(result.current.gatheredLead.need).toBe('answering the phone after hours');
      });

      it('plays out like the real thing: reworded need stays closed, an added business re-opens, a changed phone stays closed', async () => {
        postChatMock.mockResolvedValueOnce(
          ok("Here's what I've got.", { intent: 'collecting', readyToConfirm: true, lead: danaWithPhone })
        );
        const { result } = setup();
        await open(result);
        await send(result, 'Dana Lee, 770-555-0147');
        expect(result.current.showLeadForm).toBe(true);
        act(() => result.current.dismissLeadForm()); // name + phone known

        // 1. same name and phone, a reworded need: no form, chip shown
        postChatMock.mockResolvedValueOnce(
          ok('Working with us starts with a call.', {
            intent: 'collecting',
            readyToConfirm: true,
            lead: { ...danaWithPhone, need: 'wants to know how working together looks' },
          })
        );
        await send(result, 'What does working with you look like?');
        expect(result.current.showLeadForm).toBe(false);
        expect(result.current.chips).toEqual([copy.OFFER_YES]);

        // 2. a business is added: the form re-opens, pre-filled, with the heading
        trackMock.mockClear();
        postChatMock.mockResolvedValueOnce(
          ok('Thanks. Lee Landscaping, got it.', {
            intent: 'collecting',
            readyToConfirm: true,
            lead: { ...danaWithPhone, business: 'Lee Landscaping', need: 'how working together looks' },
          })
        );
        await send(result, "It's for Lee Landscaping");
        expect(result.current.showLeadForm).toBe(true);
        expect(result.current.leadHeading).toBe(copy.LEAD_FORM_HEADING);
        expect(result.current.gatheredLead).toEqual({
          ...EMPTY_LEAD_DRAFT,
          ...danaWithPhone,
          business: 'Lee Landscaping',
          need: 'how working together looks',
        });
        expect(trackMock.mock.calls.filter(([n]) => n === 'concierge_lead_form_shown')).toHaveLength(1);
        act(() => result.current.dismissLeadForm());

        // 3. a changed phone: no form, chip shown, the number is kept
        postChatMock.mockResolvedValueOnce(
          ok('Updated the number.', {
            intent: 'collecting',
            readyToConfirm: true,
            lead: { ...danaWithPhone, business: 'Lee Landscaping', phone: '4045550100' },
          })
        );
        await send(result, 'actually use 404-555-0100');
        expect(result.current.showLeadForm).toBe(false);
        expect(result.current.chips).toEqual([copy.OFFER_YES]);
        expect(result.current.gatheredLead.phone).toBe('4045550100');
      });

      it('a detail the model fills in for the first time re-opens it (here the callback window)', async () => {
        const { result } = await readyThenDismiss();
        postChatMock.mockResolvedValueOnce(
          ok('Noted the window.', {
            intent: 'collecting',
            readyToConfirm: true,
            lead: { ...GATHERED, callbackWindow: 'morning_9_11' },
          })
        );
        await send(result, 'mornings are best');
        expect(result.current.showLeadForm).toBe(true);
        expect(result.current.gatheredLead.callbackWindow).toBe('morning_9_11');
      });

      it('dismissing again takes a fresh snapshot: that detail no longer counts, a further new one does', async () => {
        const { result } = await readyThenDismiss();
        postChatMock.mockResolvedValueOnce(
          ok('Noted the window.', {
            intent: 'collecting',
            readyToConfirm: true,
            lead: { ...GATHERED, callbackWindow: 'morning_9_11' },
          })
        );
        await send(result, 'mornings are best');
        expect(result.current.showLeadForm).toBe(true);
        act(() => result.current.dismissLeadForm());

        postChatMock.mockResolvedValueOnce(
          ok('Still mornings.', {
            intent: 'collecting',
            readyToConfirm: true,
            lead: { ...GATHERED, callbackWindow: 'morning_9_11' },
          })
        );
        await send(result, 'and another question');
        expect(result.current.showLeadForm).toBe(false);

        postChatMock.mockResolvedValueOnce(
          ok('Got your email.', {
            intent: 'collecting',
            readyToConfirm: true,
            lead: { ...GATHERED, callbackWindow: 'morning_9_11', email: 'dana@example.com' },
          })
        );
        await send(result, 'my email is dana@example.com');
        expect(result.current.showLeadForm).toBe(true);
        expect(result.current.gatheredLead.email).toBe('dana@example.com');
      });

      it('"Yes, call me" and "Request a callback" always open it, whatever was dismissed', async () => {
        const { result } = await readyThenDismiss();
        await act(async () => {
          await result.current.chip('Request a callback');
        });
        expect(result.current.showLeadForm).toBe(true);
        expect(result.current.gatheredLead).toMatchObject(GATHERED);
        act(() => result.current.dismissLeadForm());

        postChatMock.mockResolvedValueOnce(ok('Want me to have someone call you?', { offerCallback: true }));
        await send(result, 'how do I get started');
        await act(async () => {
          await result.current.chip('Yes, call me');
        });
        expect(result.current.showLeadForm).toBe(true);
      });

      it('lead-only mode always opens it', async () => {
        const { result } = await readyThenDismiss();
        postChatMock.mockResolvedValueOnce({ kind: 'lead_only' });
        await send(result, 'hello again');
        expect(result.current.status).toBe('leadOnly');
        expect(result.current.showLeadForm).toBe(true);
        expect(result.current.gatheredLead).toMatchObject(GATHERED);
      });

      it('before any dismissal, readyToConfirm opens it as before', async () => {
        postChatMock.mockResolvedValueOnce(
          ok('Ready.', { intent: 'collecting', readyToConfirm: true, lead: danaWithPhone })
        );
        const { result } = setup();
        await open(result);
        await send(result, 'Dana Lee, 770-555-0147');
        expect(result.current.showLeadForm).toBe(true);
      });
    });

    describe('a dismissal survives a reload', () => {
      const dismissCallbackForm = async () => {
        const hook = setup();
        await open(hook.result);
        await act(async () => {
          await hook.result.current.chip('Request a callback');
        });
        expect(hook.result.current.showLeadForm).toBe(true);
        const lastId = hook.result.current.messages.at(-1)?.id;
        act(() => hook.result.current.dismissLeadForm());
        return { ...hook, lastId };
      };

      it('stores the id of the last message at dismissal, additively in the v1 object', async () => {
        const { lastId } = await dismissCallbackForm();
        const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '{}');
        expect(stored.leadFormDismissedAfter).toBe(lastId);
        expect(Object.keys(stored).sort()).toEqual([
          'ended',
          'leadFormDismissedAfter',
          'leadSubmitted',
          'messages',
          'sessionId',
          'utm',
        ]);
      });

      it('reloading after dismissing the "Request a callback" form keeps it closed', async () => {
        const first = await dismissCallbackForm();
        first.unmount();
        const second = setup();
        expect(second.result.current.showLeadForm).toBe(false);
        expect(second.result.current.status).toBe('idle');
        expect(second.result.current.messages.at(-1)?.content).toBe(copy.CALLBACK_INTRO);
      });

      it('without a dismissal, the same reload still resumes the form (the v1 rule)', async () => {
        const hook = setup();
        await open(hook.result);
        await act(async () => {
          await hook.result.current.chip('Request a callback');
        });
        hook.unmount();
        expect(setup().result.current.showLeadForm).toBe(true);
      });

      it('with a newer message after the dismissal, the normal rules apply again', async () => {
        const first = await dismissCallbackForm();
        // The visitor asks for the callback again: a newer "Happy to set that up" message.
        await act(async () => {
          await first.result.current.chip('Request a callback');
        });
        expect(first.result.current.showLeadForm).toBe(true);
        first.unmount();
        expect(setup().result.current.showLeadForm).toBe(true);
      });

      it('the stored id is cleared when the visitor opens the form again', async () => {
        const first = await dismissCallbackForm();
        await act(async () => {
          await first.result.current.chip('Request a callback');
        });
        const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '{}');
        expect(stored.leadFormDismissedAfter).toBeUndefined();
      });

      it('an id that does not match the last message changes nothing', async () => {
        const first = await dismissCallbackForm();
        const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '{}');
        stored.leadFormDismissedAfter = 'some-older-message-id';
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        first.unmount();
        expect(setup().result.current.showLeadForm).toBe(true);
      });
    });

    it('does nothing in lead-only mode: the form has to stay, there is nothing to chat with', async () => {
      postChatMock.mockResolvedValueOnce({ kind: 'lead_only' });
      const { result } = setup();
      await open(result);
      await send(result, 'hi');
      expect(result.current.status).toBe('leadOnly');
      act(() => result.current.dismissLeadForm());
      expect(result.current.showLeadForm).toBe(true);
      expect(result.current.status).toBe('leadOnly');
    });

    it('does nothing while a lead is being sent', async () => {
      let release: (r: LeadResult) => void = () => {};
      postLeadMock.mockImplementation(() => new Promise<LeadResult>((resolve) => (release = resolve)));
      const { result } = setup();
      await open(result);
      await act(async () => {
        await result.current.chip('Request a callback');
      });
      let pending: Promise<unknown> = Promise.resolve();
      act(() => {
        pending = result.current.submitLead(leadInput);
      });
      expect(result.current.leadSending).toBe(true);
      await vi.waitFor(() => expect(postLeadMock).toHaveBeenCalled()); // past the token step
      act(() => result.current.dismissLeadForm());
      expect(result.current.showLeadForm).toBe(true);
      await act(async () => {
        release({ kind: 'ok', delivery: 'email' });
        await pending;
      });
      expect(result.current.leadDone).toBe(true);
    });
  });

  describe('defensive: only a clean name and 10-digit phone open the ready form', () => {
    it('a ready reply with no phone does not open it (a chip offers the way in instead)', async () => {
      postChatMock.mockResolvedValueOnce(
        ok('Ready!', { intent: 'collecting', readyToConfirm: true, lead: { name: 'Dana Lee' } })
      );
      const { result } = setup();
      await open(result);
      await send(result, 'my name is Dana Lee');
      expect(result.current.showLeadForm).toBe(false);
      expect(result.current.chips).toEqual([copy.OFFER_YES]);
      expect(result.current.gatheredLead.name).toBe('Dana Lee');
    });

    it('a ready reply with no name does not open it', async () => {
      postChatMock.mockResolvedValueOnce(
        ok('Ready!', { intent: 'collecting', readyToConfirm: true, lead: { phone: '7705550147' } })
      );
      const { result } = setup();
      await open(result);
      await send(result, '770-555-0147');
      expect(result.current.showLeadForm).toBe(false);
    });

    it('a phone the cleaner rejects (not 10 digits) leaves the form closed', async () => {
      postChatMock.mockResolvedValueOnce({
        kind: 'ok',
        data: {
          reply: 'Ready!',
          intent: 'collecting',
          offerCallback: false,
          readyToConfirm: true,
          lead: { ...EMPTY_LEAD_DRAFT, name: 'Dana Lee', phone: '77055' }, // as a bypassed parser would deliver it
        },
      });
      const { result } = setup();
      await open(result);
      await send(result, 'Dana Lee 77055');
      expect(result.current.showLeadForm).toBe(false);
    });

    it('counts what was gathered over several replies: name earlier, phone now', async () => {
      postChatMock
        .mockResolvedValueOnce(ok('Thanks Dana.', { intent: 'collecting', lead: { name: 'Dana Lee' } }))
        .mockResolvedValueOnce(
          ok('Ready!', { intent: 'collecting', readyToConfirm: true, lead: { phone: '7705550147' } })
        );
      const { result } = setup();
      await open(result);
      await send(result, 'Dana Lee');
      await send(result, '770-555-0147');
      expect(result.current.showLeadForm).toBe(true);
    });
  });

  describe('an open readyToConfirm form survives a reload', () => {
    const GATHERED = { ...EMPTY_LEAD_DRAFT, name: 'Dana Lee', phone: '7705550147', business: 'Lee Landscaping', callbackWindow: 'afternoon_1_3' as const };
    const openReadyForm = async () => {
      postChatMock.mockResolvedValueOnce(
        ok("Here's what I've got.", { intent: 'collecting', readyToConfirm: true, lead: GATHERED })
      );
      const hook = setup();
      await open(hook.result);
      await send(hook.result, 'Dana Lee, 770-555-0147');
      expect(hook.result.current.showLeadForm).toBe(true);
      return hook;
    };
    const stored = () => JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '{}');

    it('stores the last message id and the gathered draft, additively', async () => {
      const hook = await openReadyForm();
      const lastId = hook.result.current.messages.at(-1)?.id;
      expect(stored().leadFormOpenAfter).toBe(lastId);
      expect(stored().leadDraft).toEqual(GATHERED);
      expect(Object.keys(stored()).sort()).toEqual([
        'ended',
        'leadDraft',
        'leadFormOpenAfter',
        'leadSubmitted',
        'messages',
        'sessionId',
        'utm',
      ]);
    });

    it('a reload brings the form back with its heading and the same details', async () => {
      const first = await openReadyForm();
      first.unmount();
      const second = setup();
      expect(second.result.current.showLeadForm).toBe(true);
      expect(second.result.current.leadHeading).toBe(copy.LEAD_FORM_HEADING);
      expect(second.result.current.gatheredLead).toEqual(GATHERED);
      expect(second.result.current.status).toBe('idle');
      expect(second.result.current.leadDone).toBe(false);
    });

    it('resuming does not count as a new appearance for analytics', async () => {
      const first = await openReadyForm();
      first.unmount();
      trackMock.mockClear();
      setup();
      expect(trackMock).not.toHaveBeenCalled();
    });

    it('seeds the draft, so a "Request a callback" after dismissing the resumed form is pre-filled', async () => {
      const first = await openReadyForm();
      first.unmount();
      const second = setup();
      act(() => second.result.current.dismissLeadForm());
      await act(async () => {
        await second.result.current.chip('Request a callback');
      });
      expect(second.result.current.showLeadForm).toBe(true);
      expect(second.result.current.gatheredLead).toEqual(GATHERED);
    });

    it('is cleared when the lead is sent, so a reload shows no form', async () => {
      const hook = await openReadyForm();
      postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
      await act(async () => {
        await hook.result.current.submitLead({ ...leadInput, name: 'Dana Lee', phone: '7705550147' });
      });
      expect(stored().leadFormOpenAfter).toBeUndefined();
      expect(stored().leadDraft).toBeUndefined();
      hook.unmount();
      expect(setup().result.current.showLeadForm).toBe(false);
    });

    it('is cleared when the form is dismissed, and the dismissal keeps it closed after a reload', async () => {
      const hook = await openReadyForm();
      act(() => hook.result.current.dismissLeadForm());
      expect(stored().leadFormOpenAfter).toBeUndefined();
      expect(stored().leadDraft).toBeUndefined();
      expect(stored().leadFormDismissedAfter).toBe(hook.result.current.messages.at(-1)?.id);
      hook.unmount();
      expect(setup().result.current.showLeadForm).toBe(false);
    });

    it('is not resumed when the marker no longer matches the last message', async () => {
      const hook = await openReadyForm();
      const s = stored();
      s.leadFormOpenAfter = 'an-older-message-id';
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      hook.unmount();
      const second = setup();
      expect(second.result.current.showLeadForm).toBe(false);
      expect(second.result.current.leadHeading).toBeNull();
    });

    it('is not resumed once a lead was already sent or the chat ended', async () => {
      const hook = await openReadyForm();
      hook.unmount();
      for (const flag of [{ leadSubmitted: true }, { ended: true }]) {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored(), ...flag }));
        expect(setup().result.current.showLeadForm, JSON.stringify(flag)).toBe(false);
      }
    });

    it('a reload of a chat with no such form shows none and has no heading', async () => {
      const hook = setup();
      await open(hook.result);
      hook.unmount();
      const second = setup();
      expect(second.result.current.showLeadForm).toBe(false);
      expect(second.result.current.leadHeading).toBeNull();
      expect(second.result.current.gatheredLead).toEqual(EMPTY_LEAD_DRAFT);
    });
  });

  describe('typed edits survive "Not now" (visitor-edited fields)', () => {
    const MODEL = { ...EMPTY_LEAD_DRAFT, name: 'Dana Lee', phone: '7705550147', business: 'Lee Landscaping' };
    const readyThenDismissWith = async (edits?: Partial<typeof MODEL>) => {
      postChatMock.mockResolvedValueOnce(
        ok("Here's what I've got.", { intent: 'collecting', readyToConfirm: true, lead: MODEL })
      );
      const hook = setup();
      await open(hook.result);
      await send(hook.result, 'Dana Lee, 770-555-0147');
      act(() => hook.result.current.dismissLeadForm(edits ? { ...MODEL, ...edits } : undefined));
      return hook;
    };

    it('merges what the visitor typed into the gathered details', async () => {
      const { result } = await readyThenDismissWith({ business: 'Lee Lawn and Garden', need: 'fewer missed calls' });
      expect(result.current.gatheredLead).toEqual({
        ...MODEL,
        business: 'Lee Lawn and Garden',
        need: 'fewer missed calls',
      });
    });

    it('the form re-opens pre-filled with the typed values, not the model\'s', async () => {
      const { result } = await readyThenDismissWith({ phone: '4045550100' });
      await act(async () => {
        await result.current.chip('Request a callback');
      });
      expect(result.current.showLeadForm).toBe(true);
      expect(result.current.gatheredLead.phone).toBe('4045550100');
    });

    it('a later model reply cannot overwrite a value the visitor typed', async () => {
      const { result } = await readyThenDismissWith({ business: 'Lee Lawn and Garden' });
      postChatMock.mockResolvedValueOnce(
        ok('Noted.', { intent: 'collecting', lead: { business: 'Lee Landscaping LLC', need: 'calls' } })
      );
      await send(result, 'we do lawns and gardens');
      expect(result.current.gatheredLead.business).toBe('Lee Lawn and Garden'); // locked
      expect(result.current.gatheredLead.need).toBe('calls'); // unlocked field still fills
    });

    it('the model re-sending its old value for an edited field is not "a new detail"', async () => {
      const { result } = await readyThenDismissWith({ phone: '4045550100' });
      postChatMock.mockResolvedValueOnce(
        ok('Anything else?', { intent: 'collecting', readyToConfirm: true, lead: MODEL }) // old phone
      );
      trackMock.mockClear();
      await send(result, 'one more question');
      expect(result.current.showLeadForm).toBe(false);
      expect(result.current.gatheredLead.phone).toBe('4045550100');
      expect(result.current.chips).toEqual([copy.OFFER_YES]);
      expect(trackMock.mock.calls.filter(([n]) => n === 'concierge_lead_form_shown')).toHaveLength(0);
    });

    it('a genuinely new detail in an unedited field still re-opens the form', async () => {
      const { result } = await readyThenDismissWith({ phone: '4045550100' });
      postChatMock.mockResolvedValueOnce(
        ok('Noted the window.', {
          intent: 'collecting',
          readyToConfirm: true,
          lead: { ...MODEL, callbackWindow: 'morning_9_11' },
        })
      );
      await send(result, 'mornings are best');
      expect(result.current.showLeadForm).toBe(true);
      expect(result.current.gatheredLead).toMatchObject({ phone: '4045550100', callbackWindow: 'morning_9_11' });
    });

    it('a field the visitor cleared is empty, and the model may fill it again', async () => {
      const { result } = await readyThenDismissWith({ business: '' });
      expect(result.current.gatheredLead.business).toBe('');
      postChatMock.mockResolvedValueOnce(
        ok('Which business?', { intent: 'collecting', lead: { business: 'Lee Landscaping' } })
      );
      await send(result, 'Lee Landscaping');
      expect(result.current.gatheredLead.business).toBe('Lee Landscaping');
    });

    it('values left as the model gave them are not locked: a model correction still applies to the draft', async () => {
      const { result } = await readyThenDismissWith({ need: 'calls' }); // only need typed
      postChatMock.mockResolvedValueOnce(
        ok('Got it.', { intent: 'collecting', readyToConfirm: true, lead: { ...MODEL, phone: '4045550100' } })
      );
      await send(result, 'use 404-555-0100');
      // A changed value does not re-open the form (the chip does), but it is not lost either.
      expect(result.current.showLeadForm).toBe(false);
      expect(result.current.chips).toEqual([copy.OFFER_YES]);
      expect(result.current.gatheredLead.phone).toBe('4045550100');
      expect(result.current.gatheredLead.need).toBe('calls');
    });

    it('a field the visitor cleared that the model then fills counts as a new detail and re-opens the form', async () => {
      const { result } = await readyThenDismissWith({ business: '' });
      postChatMock.mockResolvedValueOnce(
        ok('Which business?', { intent: 'collecting', readyToConfirm: true, lead: MODEL })
      );
      await send(result, 'Lee Landscaping');
      expect(result.current.showLeadForm).toBe(true);
      expect(result.current.gatheredLead.business).toBe('Lee Landscaping');
    });

    it('dismissing with no edits behaves as before', async () => {
      const { result } = await readyThenDismissWith();
      expect(result.current.gatheredLead).toEqual(MODEL);
    });
  });

  it('never passes lead details to analytics, anywhere in a full conversational flow', async () => {
    const lead = {
      name: 'Dana Lee',
      phone: '7705550147',
      email: 'dana@example.com',
      business: 'Lee Landscaping',
      need: 'missed after-hours calls',
      callbackWindow: 'afternoon_1_3' as const,
    };
    postChatMock
      .mockResolvedValueOnce(ok("Here's what I've got.", { intent: 'collecting', readyToConfirm: true, lead }))
      .mockResolvedValueOnce(ok('Fine.', { intent: 'collecting', readyToConfirm: true, lead }));
    postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
    const { result } = setup();
    await open(result);
    await send(result, 'Dana Lee, 770-555-0147, dana@example.com, Lee Landscaping');
    act(() => result.current.dismissLeadForm({ ...lead, phone: '4045550100', business: 'Lee Lawn and Garden' }));
    await send(result, 'ok go ahead and call me');
    await act(async () => {
      await result.current.chip('Yes, call me');
    });
    await act(async () => {
      await result.current.submitLead({ ...leadInput, name: 'Dana Lee', phone: '4045550100' });
    });

    const everything = JSON.stringify(trackMock.mock.calls);
    expect(trackMock.mock.calls.length).toBeGreaterThan(3); // there were events to scan
    for (const secret of ['Dana', 'Lee', '7705550147', '770', '404', '4045550100', 'example.com', 'Landscaping', 'Garden', 'after-hours']) {
      expect(everything, secret).not.toContain(secret);
    }
  });

  it('does not persist what was gathered: a reload starts with an empty draft', async () => {
    postChatMock.mockResolvedValueOnce(ok('Thanks Dana.', { intent: 'collecting', lead: danaWithPhone }));
    const first = setup();
    await open(first.result);
    await send(first.result, "I'm Dana Lee, 770-555-0147");
    expect(first.result.current.gatheredLead.phone).toBe('7705550147');
    first.unmount();

    const second = setup();
    expect(second.result.current.gatheredLead).toEqual(EMPTY_LEAD_DRAFT);
    expect(window.sessionStorage.getItem(STORAGE_KEY)).not.toContain('7705550147');
  });

  it('a plain reply with no lead details and not ready changes nothing about the form or the draft', async () => {
    postChatMock.mockResolvedValue({
      kind: 'ok',
      data: { reply: 'Plain.', intent: 'answer', offerCallback: false, readyToConfirm: false, lead: EMPTY_LEAD_DRAFT },
    });
    const { result } = setup();
    await open(result);
    await send(result, 'hello');
    expect(result.current.showLeadForm).toBe(false);
    expect(result.current.gatheredLead).toEqual(EMPTY_LEAD_DRAFT);
  });
});

describe('useConcierge: persistence', () => {
  it('saves to sessionStorage under the documented shape', async () => {
    window.history.replaceState({}, '', '/?utm_campaign=spring');
    const { result } = setup();
    await open(result);
    await send(result, 'hello');
    const saved = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    expect(Object.keys(saved).sort()).toEqual([
      'ended',
      'leadSubmitted',
      'messages',
      'sessionId',
      'utm',
    ]);
    expect(saved.sessionId).toBe(result.current.sessionId);
    expect(saved.messages).toHaveLength(3);
    expect(saved.utm).toEqual({ utm_campaign: 'spring' });
  });

  it('restores the thread, session and flags in a fresh instance', async () => {
    postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
    const first = setup();
    await open(first.result);
    await send(first.result, 'hello');
    await act(async () => {
      await first.result.current.submitLead(leadInput);
    });
    first.unmount();

    const second = setup();
    expect(second.result.current.sessionId).toBe(first.result.current.sessionId);
    expect(second.result.current.messages).toEqual(first.result.current.messages);
    expect(second.result.current.leadDone).toBe(true);
    expect(second.result.current.turn).toBe(1);
  });

  it('restores the ended state', async () => {
    postChatMock.mockResolvedValue({ kind: 'ended' });
    const first = setup();
    await open(first.result);
    await send(first.result, 'rude');
    first.unmount();
    const second = setup();
    expect(second.result.current.status).toBe('ended');
  });

  it('brings the lead form back after a reload while it was open', async () => {
    const first = setup();
    await open(first.result);
    await act(async () => {
      await first.result.current.chip('Request a callback');
    });
    expect(first.result.current.showLeadForm).toBe(true);
    first.unmount();

    const second = setup();
    expect(second.result.current.showLeadForm).toBe(true);
    expect(second.result.current.status).toBe('idle');
  });

  it('does not bring the form back once the lead was sent', async () => {
    postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
    const first = setup();
    await open(first.result);
    await act(async () => {
      await first.result.current.chip('Request a callback');
    });
    await act(async () => {
      await first.result.current.submitLead(leadInput);
    });
    first.unmount();
    const second = setup();
    expect(second.result.current.showLeadForm).toBe(false);
  });

  it('returns to lead-only mode after a reload when the chat was unavailable', async () => {
    postChatMock.mockResolvedValue({ kind: 'lead_only' });
    const first = setup();
    await open(first.result);
    await send(first.result, 'hi');
    first.unmount();
    const second = setup();
    expect(second.result.current.status).toBe('leadOnly');
    expect(second.result.current.showLeadForm).toBe(true);
  });

  it('shows the quick replies again after a reload that only has the greeting', async () => {
    const first = setup();
    await open(first.result);
    first.unmount();
    const second = setup();
    expect(second.result.current.chips).toEqual(copy.CHIPS);
  });

  it('keeps working when sessionStorage is unavailable', async () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    try {
      const { result } = setup();
      await open(result);
      await send(result, 'hello');
      expect(result.current.messages).toHaveLength(3);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
