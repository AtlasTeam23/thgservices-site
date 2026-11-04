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

const reply = (text: string, over: { intent?: 'answer' | 'handoff'; offerCallback?: boolean } = {}) =>
  ({
    kind: 'ok',
    data: { reply: text, intent: over.intent ?? 'answer', offerCallback: over.offerCallback ?? false },
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
