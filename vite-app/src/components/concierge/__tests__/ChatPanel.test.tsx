import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => ({ postChat: vi.fn(), postLead: vi.fn() }));
vi.mock('../turnstile', () => ({ getToken: vi.fn() }));
vi.mock('../../../lib/track', () => ({ track: vi.fn() }));
vi.mock('../../../hooks/useLenis', () => ({ getLenis: vi.fn() }));

import ChatPanel, { type OpenRequest } from '../ChatPanel';
import { postChat, postLead } from '../api';
import { getToken } from '../turnstile';
import { getLenis } from '../../../hooks/useLenis';
import { STORAGE_KEY } from '../storage';
import { EMPTY_LEAD_DRAFT } from '../leadDraft';
import type { Intent, LeadDraft } from '../types';
import { track } from '../../../lib/track';
import * as copy from '../copy';

const postChatMock = vi.mocked(postChat);
const postLeadMock = vi.mocked(postLead);

function Harness({
  open = true,
  request = { id: 1, source: 'bubble' } as OpenRequest | null,
  onClose = () => {},
}: {
  open?: boolean;
  request?: OpenRequest | null;
  onClose?: () => void;
}) {
  const bubbleRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={bubbleRef}>bubble</button>
      <input aria-label="outside field" />
      <ChatPanel open={open} request={request} onClose={onClose} returnFocusRef={bubbleRef} />
    </>
  );
}

const reply = (
  text: string,
  over: {
    intent?: Intent;
    offerCallback?: boolean;
    readyToConfirm?: boolean;
    lead?: Partial<LeadDraft>;
  } = {}
) =>
  ({
    kind: 'ok',
    data: {
      reply: text,
      intent: over.intent ?? 'answer',
      offerCallback: over.offerCallback ?? false,
      readyToConfirm: over.readyToConfirm ?? false,
      lead: { ...EMPTY_LEAD_DRAFT, ...over.lead },
    },
  }) as const;

const stubMatchMedia = (matching: string[]) => {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: matching.some((m) => query.includes(m)),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.mocked(getToken).mockResolvedValue(null);
  postChatMock.mockResolvedValue(reply('We help local businesses save time.'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.overflow = '';
});

describe('ChatPanel', () => {
  it('is a labelled dialog with the AI disclosure and the greeting', async () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog', { name: copy.PANEL_TITLE });
    expect(dialog).toHaveAccessibleDescription(copy.DISCLOSURE);
    expect(dialog).not.toHaveAttribute('aria-modal'); // desktop: not modal
    expect(await screen.findByText(copy.GREETING)).toBeInTheDocument();
    for (const chip of copy.CHIPS) {
      expect(screen.getByRole('button', { name: chip })).toBeInTheDocument();
    }
  });

  it('is modal on a phone-sized screen and keeps the page behind it from scrolling', () => {
    const lenis = { stop: vi.fn(), start: vi.fn() };
    vi.mocked(getLenis).mockReturnValue(lenis as unknown as ReturnType<typeof getLenis>);
    stubMatchMedia(['max-width: 640px']);
    const { rerender } = render(<Harness />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    // Native scroll is locked, and Lenis (which would otherwise smooth-scroll the page) is stopped.
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(lenis.stop).toHaveBeenCalledTimes(1);
    expect(lenis.start).not.toHaveBeenCalled();

    rerender(<Harness open={false} />);
    expect(document.documentElement.style.overflow).toBe('');
    expect(lenis.start).toHaveBeenCalledTimes(1);
  });

  it('starts Lenis again if the panel unmounts while open on a phone', () => {
    const lenis = { stop: vi.fn(), start: vi.fn() };
    vi.mocked(getLenis).mockReturnValue(lenis as unknown as ReturnType<typeof getLenis>);
    stubMatchMedia(['max-width: 640px']);
    const { unmount } = render(<Harness />);
    unmount();
    expect(lenis.start).toHaveBeenCalledTimes(1);
  });

  it('does not touch Lenis for the floating desktop panel, which is not modal', () => {
    const lenis = { stop: vi.fn(), start: vi.fn() };
    vi.mocked(getLenis).mockReturnValue(lenis as unknown as ReturnType<typeof getLenis>);
    render(<Harness />);
    expect(lenis.stop).not.toHaveBeenCalled();
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('works when Lenis is not running (a route without smooth scrolling)', () => {
    vi.mocked(getLenis).mockReturnValue(null);
    stubMatchMedia(['max-width: 640px']);
    expect(() => render(<Harness />)).not.toThrow();
  });

  it('marks the whole panel as a Lenis-protected scroll area', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-lenis-prevent');
  });

  it('moves focus to the composer on open', async () => {
    render(<Harness />);
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveFocus();
  });

  it('never pulls focus from a field outside the panel when a reply and its chips arrive', async () => {
    const user = userEvent.setup();
    let release: (r: ReturnType<typeof reply>) => void = () => {};
    postChatMock.mockImplementation(
      () => new Promise((resolve) => (release = resolve as typeof release)) as ReturnType<typeof postChat>
    );
    render(<Harness />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'how do I start{Enter}');

    // While the reply is on its way the visitor clicks into another field on the page.
    screen.getByLabelText('outside field').focus();
    await act(async () => {
      release(reply('Want me to have someone call you?', { offerCallback: true }));
    });

    expect(await screen.findByRole('button', { name: 'Yes, call me' })).toBeInTheDocument();
    expect(screen.getByLabelText('outside field')).toHaveFocus();
  });

  it('does not pull focus from outside either when the chat falls back to the lead form', async () => {
    const user = userEvent.setup();
    let release: (r: Awaited<ReturnType<typeof postChat>>) => void = () => {};
    postChatMock.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    render(<Harness />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'hello{Enter}');
    screen.getByLabelText('outside field').focus();
    await act(async () => {
      release({ kind: 'lead_only' });
    });
    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('outside field')).toHaveFocus();
  });

  it('refocuses the composer when the focused element was removed from the page', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const chip = await screen.findByRole('button', { name: 'What do you do?' });
    await user.click(chip); // the chip disappears under the focus ring
    expect(await screen.findByText('We help local businesses save time.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
  });

  it('puts focus on the first control, not a disabled composer, when the chat has ended', async () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessionId: '3f2b8c1e-5d4a-4e7b-9c6d-1a2b3c4d5e6f',
        messages: [
          { id: 'g', role: 'assistant', content: copy.GREETING, at: 'now', greeting: true },
          { id: 'u', role: 'user', content: 'rude', at: 'now' },
          { id: 'e', role: 'assistant', content: copy.ENDED, at: 'now' },
        ],
        ended: true,
        leadSubmitted: false,
        utm: {},
      })
    );
    render(<Harness request={null} />);
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close chat' })).toHaveFocus();
  });

  describe('short viewports (a landscape phone, or the on-screen keyboard open)', () => {
    const realInnerHeight = window.innerHeight;
    afterEach(() => {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: realInnerHeight });
    });

    it('is not marked short on a normal screen, and shows the footer call link', () => {
      render(<Harness />);
      expect(screen.getByRole('dialog')).not.toHaveAttribute('data-short');
      expect(screen.getByRole('link', { name: copy.FOOTER_CALL })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: `Call ${copy.PHONE_DISPLAY}` })).not.toBeInTheDocument();
    });

    it('is marked short below 480px and moves the call link into the header', async () => {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 367 });
      const user = userEvent.setup();
      render(<Harness />);
      expect(screen.getByRole('dialog')).toHaveAttribute('data-short', 'true');
      expect(screen.queryByRole('link', { name: copy.FOOTER_CALL })).not.toBeInTheDocument();
      const call = screen.getByRole('link', { name: `Call ${copy.PHONE_DISPLAY}` });
      expect(call).toHaveAttribute('href', copy.PHONE_HREF);
      await user.click(call);
      expect(track).toHaveBeenCalledWith('concierge_call_click', { location: 'panel' });
    });

    it('measures from the visual viewport when there is one, so the keyboard counts', () => {
      const vv = Object.assign(new EventTarget(), { height: 300, offsetTop: 0 });
      vi.stubGlobal('visualViewport', vv);
      render(<Harness />);
      expect(screen.getByRole('dialog')).toHaveAttribute('data-short', 'true');
      act(() => {
        vv.height = 700;
        vv.dispatchEvent(new Event('resize'));
      });
      expect(screen.getByRole('dialog')).not.toHaveAttribute('data-short');
    });
  });

  it('leaves the keyboard down on touch screens by focusing the panel instead', () => {
    stubMatchMedia(['pointer: coarse']);
    render(<Harness />);
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('sends a typed message with Enter and shows the reply', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await user.type(box, 'Do you work with plumbers?{Enter}');
    expect(postChatMock).toHaveBeenCalledTimes(1);
    expect(postChatMock.mock.calls[0][0].messages).toEqual([
      { role: 'user', content: 'Do you work with plumbers?' },
    ]);
    expect(await screen.findByText('We help local businesses save time.')).toBeInTheDocument();
    expect(box).toHaveValue('');
  });

  it('runs a chip as a message', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'What do you do?' }));
    expect(postChatMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('We help local businesses save time.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Quick replies' })).not.toBeInTheDocument();
    // Focus stays inside the panel after the chip it was on disappears.
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('runs a quick reply passed with the open request', async () => {
    render(<Harness request={{ id: 1, source: 'section_cta', quickReply: 'Try the AI Concierge' }} />);
    expect(await screen.findByText('We help local businesses save time.')).toBeInTheDocument();
    expect(postChatMock.mock.calls[0][0].messages[0].content).toBe('Try the AI Concierge');
  });

  it('does not repeat the open request when the panel re-renders', async () => {
    const request: OpenRequest = { id: 1, source: 'section_cta', quickReply: 'Try the AI Concierge' };
    const { rerender } = render(<Harness request={request} />);
    await screen.findByText('We help local businesses save time.');
    rerender(<Harness request={request} />);
    rerender(<Harness request={{ ...request }} />);
    expect(postChatMock).toHaveBeenCalledTimes(1);
  });

  it('collects a callback end to end and shows the confirmation', async () => {
    const user = userEvent.setup();
    postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Request a callback' }));
    expect(await screen.findByText(copy.CALLBACK_INTRO)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveFocus();

    await user.type(screen.getByLabelText('Name'), 'Jane Doe');
    await user.type(screen.getByLabelText('Phone'), '(770) 555-1234');
    await user.type(screen.getByLabelText('Business name'), 'Doe Plumbing');
    await user.selectOptions(screen.getByLabelText('Best callback window'), 'midday_11_1');
    await user.click(screen.getByLabelText(copy.CONSENT));
    await user.click(screen.getByRole('button', { name: 'Request my callback' }));

    expect(postLeadMock).toHaveBeenCalledTimes(1);
    const req = postLeadMock.mock.calls[0][0];
    expect(req).toMatchObject({
      name: 'Jane Doe',
      phone: '7705551234',
      business: 'Doe Plumbing',
      callbackWindow: 'midday_11_1',
      consent: true,
    });
    expect(req.transcript.map((t) => t.content)).toEqual(['Request a callback', copy.CALLBACK_INTRO]);

    expect(
      await screen.findByText(
        "Thanks, Jane! Someone from our team will reach out during your Midday (11 AM–1 PM ET) window. If it's urgent, call",
        { exact: false }
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Callback request' })).not.toBeInTheDocument();
    expect(track).toHaveBeenCalledWith('concierge_lead_submitted', {
      callback_window: 'midday_11_1',
      delivery: 'email',
    });
  });

  it('does not call postLead for an invalid form', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Request a callback' }));
    await user.click(await screen.findByRole('button', { name: 'Request my callback' }));
    expect(postLeadMock).not.toHaveBeenCalled();
    expect(screen.getByText('Enter your name')).toBeInTheDocument();
  });

  it('shows the phone fallback above a filled form when delivery fails', async () => {
    const user = userEvent.setup();
    postLeadMock.mockResolvedValue({ kind: 'delivery_failed' });
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Request a callback' }));
    await user.type(screen.getByLabelText('Name'), 'Jane Doe');
    await user.type(screen.getByLabelText('Phone'), '7705551234');
    await user.type(screen.getByLabelText('Business name'), 'Doe Plumbing');
    await user.selectOptions(screen.getByLabelText('Best callback window'), 'morning_9_11');
    await user.click(screen.getByLabelText(copy.CONSENT));
    await user.click(screen.getByRole('button', { name: 'Request my callback' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: copy.PHONE_DISPLAY })).toHaveAttribute(
      'href',
      copy.PHONE_HREF
    );
    // The failure is announced and focus moves to it, so a keyboard or screen-reader user notices.
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText('Name')).toHaveValue('Jane Doe');
    expect(track).toHaveBeenCalledWith('concierge_lead_failed');
  });

  it('shows the server message when a 400 names something the form has no field for', async () => {
    const user = userEvent.setup();
    postLeadMock.mockResolvedValue({
      kind: 'validation',
      fields: { transcript: 'Conversation is too long to send' },
    });
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Request a callback' }));
    await user.type(screen.getByLabelText('Name'), 'Jane Doe');
    await user.type(screen.getByLabelText('Phone'), '7705551234');
    await user.type(screen.getByLabelText('Business name'), 'Doe Plumbing');
    await user.selectOptions(screen.getByLabelText('Best callback window'), 'morning_9_11');
    await user.click(screen.getByLabelText(copy.CONSENT));
    await user.click(screen.getByRole('button', { name: 'Request my callback' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Conversation is too long to send');
    expect(alert).toHaveFocus();
  });

  describe('conversational lead capture (plan v1.1)', () => {
    const FILLED = {
      name: 'Dana Lee',
      phone: '7705550147',
      business: 'Lee Landscaping',
      need: 'missed after-hours calls',
      callbackWindow: 'afternoon_1_3' as const,
    };
    const readyReply = () =>
      reply("Here's what I've got. Check the box below and tap send.", {
        intent: 'collecting',
        readyToConfirm: true,
        lead: FILLED,
      });

    const formShown = () =>
      vi.mocked(track).mock.calls.filter(([name]) => name === 'concierge_lead_form_shown').length;

    it('shows the form pre-filled under the reply, with the heading and an unchecked box', async () => {
      const user = userEvent.setup();
      postChatMock.mockResolvedValue(readyReply());
      render(<Harness />);
      await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Dana Lee, 770-555-0147{Enter}');

      const heading = await screen.findByText("Here's what I have. Check the box and tap send.");
      expect(heading).toBeInTheDocument();
      expect(screen.getByLabelText('Name')).toHaveValue('Dana Lee');
      expect(screen.getByLabelText('Phone')).toHaveValue('(770) 555-0147');
      expect(screen.getByLabelText('Email (optional)')).toHaveValue('');
      expect(screen.getByLabelText('Business name')).toHaveValue('Lee Landscaping');
      expect(screen.getByLabelText('What do you need help with? (optional)')).toHaveValue('missed after-hours calls');
      expect(screen.getByLabelText('Best callback window')).toHaveValue('afternoon_1_3');
      expect(screen.getByLabelText(copy.CONSENT)).not.toBeChecked();
      // No composer while the form is up (as with every form), and the form follows the reply directly.
      expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
      const log = screen.getByRole('log');
      expect(
        log.compareDocumentPosition(screen.getByRole('form', { name: 'Callback request' }))
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(within(log).getAllByRole('listitem').at(-1)).toHaveTextContent("Here's what I've got.");
      expect(formShown()).toBe(1);
    });

    it('sends the pre-filled lead after one tick of the box, with the conversation as transcript', async () => {
      const user = userEvent.setup();
      postChatMock.mockResolvedValue(readyReply());
      postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
      render(<Harness />);
      await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Dana Lee, 770-555-0147{Enter}');
      await screen.findByLabelText('Name');

      await user.click(screen.getByLabelText(copy.CONSENT));
      await user.click(screen.getByRole('button', { name: 'Request my callback' }));

      expect(postLeadMock).toHaveBeenCalledTimes(1);
      const req = postLeadMock.mock.calls[0][0];
      expect(req).toMatchObject({ ...FILLED, consent: true });
      expect(req.transcript.map((t) => t.content)).toEqual([
        'Dana Lee, 770-555-0147',
        "Here's what I've got. Check the box below and tap send.",
      ]);
      expect(
        await screen.findByText(/Thanks, Dana! Someone from our team will reach out during your Afternoon/)
      ).toBeInTheDocument();
      expect(screen.queryByText("Here's what I have. Check the box and tap send.")).not.toBeInTheDocument();
    });

    it('does not send anything until the visitor ticks the box', async () => {
      const user = userEvent.setup();
      postChatMock.mockResolvedValue(readyReply());
      render(<Harness />);
      await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Dana Lee, 770-555-0147{Enter}');
      await user.click(await screen.findByRole('button', { name: 'Request my callback' }));
      expect(postLeadMock).not.toHaveBeenCalled();
      expect(screen.getByText('Check this box so we can contact you')).toBeInTheDocument();
    });

    it('follows a three-turn collection: the form appears only once name and number are in', async () => {
      const user = userEvent.setup();
      postChatMock
        .mockResolvedValueOnce(reply('Happy to. What is your name?', { intent: 'collecting' }))
        .mockResolvedValueOnce(
          reply('Thanks, Dana. What is the best number to reach you?', {
            intent: 'collecting',
            lead: { name: 'Dana Lee' },
          })
        )
        .mockResolvedValueOnce(
          reply("Here's what I've got. Check the box below and tap send.", {
            intent: 'collecting',
            readyToConfirm: true,
            lead: { name: 'Dana Lee', phone: '7705550147' },
          })
        );
      render(<Harness />);
      const box = await screen.findByRole('textbox', { name: 'Message' });

      await user.type(box, 'can you have someone call me?{Enter}');
      await screen.findByText('Happy to. What is your name?');
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();

      await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Dana Lee{Enter}');
      await screen.findByText('Thanks, Dana. What is the best number to reach you?');
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();

      await user.type(screen.getByRole('textbox', { name: 'Message' }), '770-555-0147{Enter}');
      expect(await screen.findByLabelText('Name')).toHaveValue('Dana Lee');
      expect(screen.getByLabelText('Phone')).toHaveValue('(770) 555-0147');
      expect(screen.getByLabelText('Business name')).toHaveValue('');
      expect(screen.getByLabelText(copy.CONSENT)).not.toBeChecked();
      expect(formShown()).toBe(1);
    });

    it('"Yes, call me" after partial details opens the form with what was gathered', async () => {
      const user = userEvent.setup();
      postChatMock.mockResolvedValue(
        reply('Thanks Dana. Want me to have someone call you?', {
          intent: 'collecting',
          offerCallback: true,
          lead: { name: 'Dana Lee', business: 'Lee Landscaping' },
        })
      );
      render(<Harness />);
      await user.type(
        await screen.findByRole('textbox', { name: 'Message' }),
        "I'm Dana Lee at Lee Landscaping, can you help with calls?{Enter}"
      );
      await user.click(await screen.findByRole('button', { name: 'Yes, call me' }));

      expect(await screen.findByLabelText('Name')).toHaveValue('Dana Lee');
      expect(screen.getByLabelText('Business name')).toHaveValue('Lee Landscaping');
      expect(screen.getByLabelText('Phone')).toHaveValue('');
      expect(screen.getByLabelText(copy.CONSENT)).not.toBeChecked();
      // This form was asked for by the visitor, so no "here's what I have" heading.
      expect(screen.queryByText("Here's what I have. Check the box and tap send.")).not.toBeInTheDocument();
      expect(screen.getByText(copy.CALLBACK_INTRO)).toBeInTheDocument();
    });

    describe('"Not now, keep chatting"', () => {
      const dismissName = copy.LEAD_FORM_DISMISS;

      it('hides the form and brings the composer back, focused', async () => {
        const user = userEvent.setup();
        postChatMock.mockResolvedValue(readyReply());
        render(<Harness />);
        await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Dana Lee, 770-555-0147{Enter}');
        await screen.findByLabelText('Name');
        vi.mocked(track).mockClear();

        await user.click(screen.getByRole('button', { name: dismissName }));

        expect(screen.queryByRole('form', { name: 'Callback request' })).not.toBeInTheDocument();
        expect(screen.queryByText("Here's what I have. Check the box and tap send.")).not.toBeInTheDocument();
        const composer = screen.getByRole('textbox', { name: 'Message' });
        expect(composer).toHaveFocus();
        expect(screen.getByRole('alert')).toBeEmptyDOMElement(); // the composer's alert: no error shown
        expect(track).not.toHaveBeenCalled();
        // The reply it was attached to is still the last message.
        expect(within(screen.getByRole('log')).getAllByRole('listitem').at(-1)).toHaveTextContent("Here's what I've got.");
      });

      it('lets the visitor keep talking, and what was gathered pre-fills the form when it comes back', async () => {
        const user = userEvent.setup();
        postChatMock
          .mockResolvedValueOnce(readyReply())
          .mockResolvedValueOnce(
            reply('Happy to explain. Want me to have someone call you?', { offerCallback: true })
          );
        render(<Harness />);
        await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Dana Lee, 770-555-0147{Enter}');
        await user.click(await screen.findByRole('button', { name: dismissName }));

        await user.type(screen.getByRole('textbox', { name: 'Message' }), 'what does call handling do?{Enter}');
        await user.click(await screen.findByRole('button', { name: 'Yes, call me' }));

        expect(await screen.findByLabelText('Name')).toHaveValue('Dana Lee');
        expect(screen.getByLabelText('Phone')).toHaveValue('(770) 555-0147');
        expect(screen.getByLabelText('Business name')).toHaveValue('Lee Landscaping');
        expect(screen.getByLabelText(copy.CONSENT)).not.toBeChecked();
        expect(postLeadMock).not.toHaveBeenCalled();
      });

      it('does not bring the form back for an unrelated question, even when the model rewords the need', async () => {
        const user = userEvent.setup();
        postChatMock
          .mockResolvedValueOnce(readyReply())
          // The model carries the lead forward, says ready again, and rewords the need every turn.
          .mockResolvedValueOnce(
            reply('Working with us starts with a quick call.', {
              intent: 'collecting',
              readyToConfirm: true,
              lead: { ...FILLED, need: 'wants to understand what working together looks like' },
            })
          )
          .mockResolvedValueOnce(
            reply('Call handling answers every call.', {
              intent: 'collecting',
              readyToConfirm: true,
              lead: { ...FILLED, need: 'call handling' },
            })
          );
        render(<Harness />);
        await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Dana Lee, 770-555-0147{Enter}');
        await user.click(await screen.findByRole('button', { name: dismissName }));

        await user.type(screen.getByRole('textbox', { name: 'Message' }), 'What does working with you look like?{Enter}');
        expect(await screen.findByText('Working with us starts with a quick call.')).toBeInTheDocument();
        expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'Yes, call me' })).toBeInTheDocument();

        await user.type(screen.getByRole('textbox', { name: 'Message' }), 'what does call handling do?{Enter}');
        expect(await screen.findByText('Call handling answers every call.')).toBeInTheDocument();
        expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();

        // The chip still brings it back, with the latest wording of the need.
        await user.click(screen.getByRole('button', { name: 'Yes, call me' }));
        expect(await screen.findByLabelText('What do you need help with? (optional)')).toHaveValue('call handling');
      });

      it('a changed phone number keeps the form closed with a chip; a newly given email brings it back', async () => {
        const user = userEvent.setup();
        postChatMock
          .mockResolvedValueOnce(readyReply())
          .mockResolvedValueOnce(
            reply('Got the new number.', {
              intent: 'collecting',
              readyToConfirm: true,
              lead: { ...FILLED, phone: '4045550100' },
            })
          )
          .mockResolvedValueOnce(
            reply('Thanks, noted your email.', {
              intent: 'collecting',
              readyToConfirm: true,
              lead: { ...FILLED, phone: '4045550100', email: 'dana@example.com' },
            })
          );
        render(<Harness />);
        await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Dana Lee, 770-555-0147{Enter}');
        await user.click(await screen.findByRole('button', { name: dismissName }));

        await user.type(screen.getByRole('textbox', { name: 'Message' }), 'use 404-555-0100{Enter}');
        expect(await screen.findByText('Got the new number.')).toBeInTheDocument();
        expect(screen.queryByLabelText('Phone')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Yes, call me' })).toBeInTheDocument();

        await user.type(screen.getByRole('textbox', { name: 'Message' }), 'my email is dana@example.com{Enter}');
        expect(await screen.findByLabelText('Email (optional)')).toHaveValue('dana@example.com');
        expect(screen.getByLabelText('Phone')).toHaveValue('(404) 555-0100'); // the changed number is in it
        expect(screen.getByLabelText(copy.CONSENT)).not.toBeChecked();
        expect(screen.getByText("Here's what I have. Check the box and tap send.")).toBeInTheDocument();
      });

      it('"ok, go ahead and call me" after a dismissal: a Yes, call me chip brings the form back', async () => {
        const user = userEvent.setup();
        postChatMock
          .mockResolvedValueOnce(readyReply())
          .mockResolvedValueOnce(
            reply('Great. Check the box below and tap send.', {
              intent: 'collecting',
              readyToConfirm: true,
              lead: FILLED,
            })
          );
        render(<Harness />);
        await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Dana Lee, 770-555-0147{Enter}');
        await user.click(await screen.findByRole('button', { name: dismissName }));
        await user.type(screen.getByRole('textbox', { name: 'Message' }), 'ok, go ahead and call me{Enter}');

        await screen.findByText('Great. Check the box below and tap send.');
        expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
        await user.click(await screen.findByRole('button', { name: 'Yes, call me' }));

        expect(await screen.findByLabelText('Name')).toHaveValue('Dana Lee');
        expect(screen.getByLabelText('Phone')).toHaveValue('(770) 555-0147');
        expect(screen.getByLabelText(copy.CONSENT)).not.toBeChecked();
        expect(screen.queryByText("Here's what I have. Check the box and tap send.")).not.toBeInTheDocument();
      });

      it('keeps what the visitor typed in the form when they choose "Not now"', async () => {
        const user = userEvent.setup();
        postChatMock.mockResolvedValueOnce(readyReply()).mockResolvedValueOnce(
          reply('Want me to have someone call you?', { offerCallback: true })
        );
        render(<Harness />);
        await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Dana Lee, 770-555-0147{Enter}');
        const business = await screen.findByLabelText('Business name');
        await user.clear(business);
        await user.type(business, 'Lee Lawn and Garden');
        await user.click(screen.getByRole('button', { name: dismissName }));

        await user.type(screen.getByRole('textbox', { name: 'Message' }), 'how does it work?{Enter}');
        await user.click(await screen.findByRole('button', { name: 'Yes, call me' }));
        expect(await screen.findByLabelText('Business name')).toHaveValue('Lee Lawn and Garden');
      });

      it('is also offered on the form the visitor asked for with "Request a callback"', async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.click(await screen.findByRole('button', { name: 'Request a callback' }));
        await user.click(await screen.findByRole('button', { name: dismissName }));
        expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
      });

      it('is not offered in lead-only mode, where there is nothing to chat with', async () => {
        const user = userEvent.setup();
        postChatMock.mockResolvedValue({ kind: 'lead_only' });
        render(<Harness />);
        await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'hello{Enter}');
        expect(await screen.findByLabelText('Name')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Request my callback' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: dismissName })).not.toBeInTheDocument();
      });

      it('is not offered once the chat has ended or the lead was sent (no form then)', async () => {
        const user = userEvent.setup();
        postChatMock.mockResolvedValue(readyReply());
        postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
        render(<Harness />);
        await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Dana Lee, 770-555-0147{Enter}');
        await user.click(await screen.findByLabelText(copy.CONSENT));
        await user.click(screen.getByRole('button', { name: 'Request my callback' }));
        await screen.findByText(/Thanks, Dana!/);
        expect(screen.queryByRole('button', { name: dismissName })).not.toBeInTheDocument();
      });

      it('opens focused on the consent box when the helper pre-filled the three required fields', async () => {
        const user = userEvent.setup();
        postChatMock.mockResolvedValue(readyReply());
        render(<Harness />);
        await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Dana Lee, 770-555-0147{Enter}');
        expect(await screen.findByLabelText(copy.CONSENT)).toHaveFocus();
      });

      it('opens on the phone field when only the name was gathered', async () => {
        const user = userEvent.setup();
        postChatMock.mockResolvedValue(
          reply('Thanks Dana. Want me to have someone call you?', {
            intent: 'collecting',
            offerCallback: true,
            lead: { name: 'Dana Lee' },
          })
        );
        render(<Harness />);
        await user.type(await screen.findByRole('textbox', { name: 'Message' }), "I'm Dana Lee, how much?{Enter}");
        await user.click(await screen.findByRole('button', { name: 'Yes, call me' }));
        expect(await screen.findByLabelText('Phone')).toHaveFocus();
      });
    });

    it('a reload while the pre-filled form is open brings it back: same details, heading, unchecked box', async () => {
      const user = userEvent.setup();
      postChatMock.mockResolvedValue(readyReply());
      const first = render(<Harness />);
      await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Dana Lee, 770-555-0147{Enter}');
      await screen.findByLabelText('Name');
      first.unmount();

      // A fresh page load: new panel, no open request, same tab storage.
      render(<Harness request={null} />);
      expect(await screen.findByText("Here's what I have. Check the box and tap send.")).toBeInTheDocument();
      expect(screen.getByLabelText('Name')).toHaveValue('Dana Lee');
      expect(screen.getByLabelText('Phone')).toHaveValue('(770) 555-0147');
      expect(screen.getByLabelText('Business name')).toHaveValue('Lee Landscaping');
      expect(screen.getByLabelText(copy.CONSENT)).not.toBeChecked();
      expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
    });

    it('lets the visitor fix a detail before sending', async () => {
      const user = userEvent.setup();
      postChatMock.mockResolvedValue(readyReply());
      postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
      render(<Harness />);
      await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Dana, 770-555-0147{Enter}');
      const business = await screen.findByLabelText('Business name');
      await user.clear(business);
      await user.type(business, 'Lee Lawn and Garden');
      await user.click(screen.getByLabelText(copy.CONSENT));
      await user.click(screen.getByRole('button', { name: 'Request my callback' }));
      expect(postLeadMock.mock.calls[0][0].business).toBe('Lee Lawn and Garden');
    });
  });

  it('offers the callback when the reply asks for it', async () => {
    const user = userEvent.setup();
    postChatMock.mockResolvedValue(reply('Want me to have someone call you?', { offerCallback: true }));
    render(<Harness />);
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await user.type(box, 'how do I get started{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Yes, call me' }));
    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
  });

  it('switches to the lead form when the chat service is unavailable', async () => {
    const user = userEvent.setup();
    postChatMock.mockResolvedValue({ kind: 'lead_only' });
    render(<Harness />);
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await user.type(box, 'hello{Enter}');
    expect(await screen.findByText(copy.LEAD_ONLY)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
  });

  it('disables the composer once the chat has ended', async () => {
    const user = userEvent.setup();
    postChatMock.mockResolvedValue({ kind: 'ended' });
    render(<Harness />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'rude{Enter}');
    expect(await screen.findByText(/I'm going to step out of this chat/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
  });

  it('answers a request for a person locally with a tap-to-call link', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(
      await screen.findByRole('textbox', { name: 'Message' }),
      'can I talk to a real person{Enter}'
    );
    expect(postChatMock).not.toHaveBeenCalled();
    const log = screen.getByRole('log');
    expect(within(log).getByRole('link', { name: copy.PHONE_DISPLAY })).toHaveAttribute(
      'href',
      copy.PHONE_HREF
    );
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await screen.findByText(copy.GREETING);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the close button and hands focus back to the bubble', async () => {
    const user = userEvent.setup();
    let isOpen = true;
    const onClose = vi.fn(() => {
      isOpen = false;
    });
    const { rerender } = render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Close chat' }));
    expect(onClose).toHaveBeenCalled();
    rerender(<Harness open={isOpen} onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'bubble' })).toHaveFocus();
  });

  it('keeps the conversation while closed and shows it again when reopened', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'What do you do?' }));
    await screen.findByText('We help local businesses save time.');

    rerender(<Harness open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<Harness open />);
    expect(screen.getByText('We help local businesses save time.')).toBeInTheDocument();
    expect(postChatMock).toHaveBeenCalledTimes(1);
  });

  it('has a footer with the phone number and the privacy link, and tracks calls', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const call = screen.getByRole('link', { name: copy.FOOTER_CALL });
    expect(call).toHaveAttribute('href', 'tel:+18665197993');
    await user.click(call);
    expect(track).toHaveBeenCalledWith('concierge_call_click', { location: 'panel' });

    expect(screen.getByText(/AI assistant — may make mistakes\./)).toBeInTheDocument();
    const privacy = screen.getByRole('link', { name: /Privacy/ });
    expect(privacy).toHaveAttribute('href', '/privacy.html#ai-chat');
    expect(privacy).toHaveAttribute('target', '_blank');
    expect(privacy).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});
