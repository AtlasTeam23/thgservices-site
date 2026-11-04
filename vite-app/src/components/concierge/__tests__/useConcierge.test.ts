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
import type { Message } from '../types';
import { STORAGE_KEY } from '../storage';
import * as copy from '../copy';

const postChatMock = vi.mocked(postChat);
const postLeadMock = vi.mocked(postLead);
const getTokenMock = vi.mocked(getToken);
const trackMock = vi.mocked(track);

const ok = (
  reply: string,
  over: Partial<{ intent: string; offerCallback: boolean }> = {}
): ChatResult => ({
  kind: 'ok',
  data: {
    reply,
    intent: (over.intent ?? 'answer') as 'answer',
    offerCallback: over.offerCallback ?? false,
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
