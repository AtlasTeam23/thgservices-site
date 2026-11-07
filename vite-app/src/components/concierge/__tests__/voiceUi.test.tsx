import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatResult } from '../api';

vi.mock('../api', () => ({
  postChat: vi.fn(),
  postLead: vi.fn(),
  fetchTts: vi.fn(),
  fetchVoiceCaps: vi.fn(),
}));
vi.mock('../turnstile', () => ({ getToken: vi.fn() }));
vi.mock('../../../lib/track', () => ({ track: vi.fn() }));
vi.mock('../../../hooks/useLenis', () => ({ getLenis: vi.fn() }));
vi.mock('../voice/speech', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../voice/speech')>()),
  speak: vi.fn(),
  speakBlob: vi.fn(),
  stopSpeaking: vi.fn(),
  unlockSpeech: vi.fn(),
}));

import ChatPanel, { type OpenRequest } from '../ChatPanel';
import Composer from '../Composer';
import Equalizer from '../Equalizer';
import { fetchVoiceCaps, postChat, postLead } from '../api';
import { getToken } from '../turnstile';
import { track } from '../../../lib/track';
import { speak, speakBlob, stopSpeaking, unlockSpeech } from '../voice/speech';
import { EMPTY_LEAD_DRAFT } from '../leadDraft';
import { VOICE_PREFS_KEY } from '../voice/prefs';
import * as vc from '../voice/copy';
import * as copy from '../copy';

const speakMock = vi.mocked(speak);
const stopSpeakingMock = vi.mocked(stopSpeaking);
const unlockMock = vi.mocked(unlockSpeech);
const speakBlobMock = vi.mocked(speakBlob);
const postLeadMock = vi.mocked(postLead);
const postChatMock = vi.mocked(postChat);
const trackMock = vi.mocked(track);

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

const okChat = (reply: string): ChatResult => ({
  kind: 'ok',
  data: {
    reply,
    intent: 'answer',
    offerCallback: false,
    readyToConfirm: false,
    lead: { ...EMPTY_LEAD_DRAFT },
  },
});

const settle = async () => {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.mocked(getToken).mockResolvedValue(null);
  postChatMock.mockResolvedValue(okChat('We help local businesses save time.'));
  vi.mocked(fetchVoiceCaps).mockResolvedValue({ tts: 'server' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.style.overflow = '';
});

describe('Equalizer', () => {
  it('is a button that stops the reading', async () => {
    const onStop = vi.fn();
    const user = userEvent.setup();
    render(<Equalizer onStop={onStop} />);
    const button = screen.getByRole('button', { name: vc.VOICE_STOP_SPEAKING });
    expect(button).toHaveAttribute('data-mode', 'speaking');
    expect(button.querySelectorAll('i')).toHaveLength(5);
    await user.click(button);
    expect(onStop).toHaveBeenCalledTimes(1);
    button.focus();
    await user.keyboard(' ');
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it('reduced motion: marked as such', () => {
    stubMatchMedia(['prefers-reduced-motion']);
    const { container } = render(<Equalizer onStop={() => {}} />);
    expect(container.querySelector('.thg-cc-eq')).toHaveAttribute('data-motion', 'reduced');
  });

  it('full motion is the default', () => {
    const { container } = render(<Equalizer onStop={() => {}} />);
    expect(container.querySelector('.thg-cc-eq')).not.toHaveAttribute('data-motion');
  });
});

// ---- Composer ----------------------------------------------------------------

describe('Composer with spoken replies', () => {
  const setup = (extra: Partial<Parameters<typeof Composer>[0]> = {}) =>
    render(<Composer onSend={vi.fn()} busy={false} disabled={false} error={null} {...extra} />);

  it('has no microphone control, whatever the voice state', () => {
    setup({ readAloudNote: true });
    expect(screen.queryByRole('button', { name: /talk|microphone|record/i })).not.toBeInTheDocument();
    // Only the Send button sits beside the text box.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
  });

  it('shows the read-aloud line under the composer once voice has been used', () => {
    const { rerender } = setup();
    expect(screen.queryByText(vc.VOICE_DISCLOSURE)).not.toBeInTheDocument();
    rerender(<Composer onSend={vi.fn()} busy={false} disabled={false} error={null} readAloudNote />);
    expect(screen.getByText(vc.VOICE_DISCLOSURE)).toBeInTheDocument();
    expect(vc.VOICE_DISCLOSURE).toBe('Replies are read aloud. Use the speaker button to turn sound off.');
  });

  it('shows a voice notice in the alert line without calling the text box invalid', () => {
    setup({ notice: vc.VOICE_SOUND_OFF_HINT });
    expect(screen.getByRole('alert')).toHaveTextContent(vc.VOICE_SOUND_OFF_HINT);
    expect(screen.getByRole('textbox', { name: 'Message' })).not.toHaveAttribute('aria-invalid');
    document.body.innerHTML = '';
    // A real typing problem still does.
    setup({ error: 'Too long', notice: vc.VOICE_SOUND_OFF_HINT });
    expect(screen.getByRole('alert')).toHaveTextContent('Too long');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute('aria-invalid', 'true');
  });

  describe('the read-aloud notice is a live region that is always there', () => {
    const regionOf = (container: HTMLElement) =>
      container.querySelector<HTMLElement>('.thg-cc-readaloud [role="status"]');
    const renderComposer = (readAloudBonus?: { count: number; onShare: () => void }) => (
      <Composer
        onSend={vi.fn()}
        busy={false}
        disabled={false}
        error={null}
        readAloudBonus={readAloudBonus}
      />
    );

    it('is mounted, empty, before there is anything to say (so a screen reader is already listening)', () => {
      const { container } = render(renderComposer());
      const region = regionOf(container);
      expect(region).not.toBeNull();
      expect(region).toBeEmptyDOMElement();
      expect(screen.queryByRole('button', { name: vc.VOICE_SHARE_DETAILS })).not.toBeInTheDocument();
    });

    it('is the same element when the text arrives and when it goes: filled, not newly inserted', () => {
      const { container, rerender } = render(renderComposer());
      const before = regionOf(container)!;
      rerender(renderComposer({ count: 5, onShare: vi.fn() }));
      const during = regionOf(container)!;
      expect(during).toBe(before);
      expect(during).toHaveTextContent("Read-aloud is paused. Share your name, email and number and we'll add 5 more today.");
      expect(during).not.toContainElement(screen.getByRole('button', { name: vc.VOICE_SHARE_DETAILS }));
      rerender(renderComposer());
      expect(regionOf(container)).toBe(before);
      expect(before).toBeEmptyDOMElement();
      expect(screen.queryByRole('button', { name: vc.VOICE_SHARE_DETAILS })).not.toBeInTheDocument();
    });

    it('its chip works', async () => {
      const user = userEvent.setup();
      const onShare = vi.fn();
      render(renderComposer({ count: 5, onShare }));
      await user.click(screen.getByRole('button', { name: vc.VOICE_SHARE_DETAILS }));
      expect(onShare).toHaveBeenCalledTimes(1);
    });
  });

  it('typing still works', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hi');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });
});

// ---- The panel, end to end (speech and Worker mocked) --------------

function Harness({
  open = true,
  request = { id: 1, source: 'bubble' } as OpenRequest | null,
}: {
  open?: boolean;
  request?: OpenRequest | null;
}) {
  const bubbleRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={bubbleRef}>bubble</button>
      <ChatPanel open={open} request={request} onClose={() => {}} returnFocusRef={bubbleRef} />
    </>
  );
}

const renderPanel = async (props: Parameters<typeof Harness>[0] = {}) => {
  const utils = render(<Harness {...props} />);
  await settle();
  return utils;
};

// There is no voice input: nothing in the panel is a microphone or a talk button.
const mic = () => screen.queryByRole('button', { name: /talk|microphone|record|listen/i });
const speakerToggle = () => screen.queryByRole('button', { name: vc.VOICE_SPEAK_TOGGLE });

describe('ChatPanel voice', () => {
  it('shows no voice controls when the Worker has no voice, and the text chat is untouched', async () => {
    vi.mocked(fetchVoiceCaps).mockResolvedValue(null);
    await renderPanel();
    expect(mic()).not.toBeInTheDocument();
    expect(speakerToggle()).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  });

  it('shows the speaker toggle in the header and no microphone anywhere when a server voice is on', async () => {
    await renderPanel();
    expect(mic()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hold to talk|Click to talk/ })).not.toBeInTheDocument();
    const toggle = speakerToggle()!;
    expect(toggle).toHaveAttribute('aria-pressed', 'true'); // sound is on by default
    expect(toggle.closest('.thg-cc-header')).not.toBeNull();
    // Only the Send button is beside the text box.
    expect(screen.getByRole('textbox', { name: 'Message' }).parentElement!.querySelectorAll('button')).toHaveLength(1);
  });

  it('a typed question gets a reply that is read aloud by default, with no recording events', async () => {
    const user = userEvent.setup();
    await renderPanel();
    expect(unlockMock).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'what do you do{Enter}');
    await settle();
    expect(postChatMock).toHaveBeenCalledTimes(1);
    const log = screen.getByRole('log', { name: 'Conversation' });
    expect(within(log).getByText('We help local businesses save time.')).toBeInTheDocument();
    expect(speakMock).toHaveBeenCalledWith('We help local businesses save time.', expect.anything());
    const events = trackMock.mock.calls.map(([event]) => event);
    expect(events).not.toContain('concierge_voice_start');
    expect(events).not.toContain('concierge_voice_transcribed');
    expect(events).not.toContain('concierge_voice_empty');
  });

  it('the speaker toggle flips, and is remembered when the panel is built again in the same tab', async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: false, disclosed: false }));
    const first = await renderPanel();
    await user.click(speakerToggle()!);
    expect(speakerToggle()).toHaveAttribute('aria-pressed', 'true');
    expect(unlockMock).toHaveBeenCalled(); // inside the tap, so iOS lets audio start later
    expect(JSON.parse(window.sessionStorage.getItem(VOICE_PREFS_KEY)!)).toEqual({
      speak: true,
      disclosed: false,
    });
    first.unmount();

    await renderPanel();
    expect(speakerToggle()).toHaveAttribute('aria-pressed', 'true');
    await user.click(speakerToggle()!);
    expect(speakerToggle()).toHaveAttribute('aria-pressed', 'false');
    expect(stopSpeakingMock).toHaveBeenCalled();
  });

  it('while a reply is read aloud the header equalizer moves and a tap on it stops the reading', async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: true, disclosed: true }));
    await renderPanel();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hello{Enter}');
    await settle();
    expect(document.querySelector('.thg-cc-eq')).toBeNull();

    const hooks = speakMock.mock.calls[0][1]!;
    act(() => hooks.onStart?.('server'));
    const eq = screen.getByRole('button', { name: vc.VOICE_STOP_SPEAKING });
    expect(eq.closest('.thg-cc-header')).not.toBeNull();
    expect(eq).toHaveAttribute('data-mode', 'speaking');

    stopSpeakingMock.mockClear();
    await user.click(eq);
    expect(stopSpeakingMock).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: vc.VOICE_STOP_SPEAKING })).not.toBeInTheDocument();
    // The button that had focus is gone: focus must land somewhere in the chat, not on the page.
    act(() => hooks.onEnd?.());
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  });

  it('reduced motion is passed to the equalizer', async () => {
    const user = userEvent.setup();
    stubMatchMedia(['prefers-reduced-motion']);
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: true, disclosed: true }));
    await renderPanel();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hello{Enter}');
    await settle();
    act(() => speakMock.mock.calls[0][1]!.onStart?.('server'));
    expect(document.querySelector('.thg-cc-eq')).toHaveAttribute('data-motion', 'reduced');
  });

  it('closing the panel stops the reading', async () => {
    const { rerender } = await renderPanel();
    stopSpeakingMock.mockClear();
    rerender(<Harness open={false} />);
    await settle();
    expect(stopSpeakingMock).toHaveBeenCalled();
  });

  it('hiding the page (switching tabs) stops the reading', async () => {
    await renderPanel();
    stopSpeakingMock.mockClear();

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();
    } finally {
      hidden.mockRestore();
    }
    expect(stopSpeakingMock).toHaveBeenCalled();
  });

  it('typing in the composer stops the reading', async () => {
    const user = userEvent.setup();
    await renderPanel();
    stopSpeakingMock.mockClear();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'a');
    expect(stopSpeakingMock).toHaveBeenCalled();
  });
});

// ---- Review fixes ------------------------------------------------------------

/** A chat reply the test answers by hand. */
function deferredChat() {
  let resolve!: (r: ChatResult) => void;
  postChatMock.mockReturnValueOnce(
    new Promise<ChatResult>((r) => {
      resolve = r;
    })
  );
  return { resolve };
}

const typeAndSend = async (text: string) => {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'Message' }), `${text}{Enter}`);
};

const setHidden = (value: boolean) => {
  const spy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(value);
  document.dispatchEvent(new Event('visibilitychange'));
  return spy;
};

describe('ChatPanel voice: cleanup and activity', () => {
  it('unmounting the panel stops the speaker', async () => {
    const { unmount } = await renderPanel();
    stopSpeakingMock.mockClear();
    unmount();
    await settle();
    expect(stopSpeakingMock).toHaveBeenCalled();
  });

  it('a reply that arrives after the panel was closed is not read aloud; it is, once the panel is open again', async () => {
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: true, disclosed: true }));
    const { rerender } = await renderPanel();
    const chat = deferredChat();
    await typeAndSend('first question');
    rerender(<Harness open={false} />);
    await settle();

    await act(async () => {
      chat.resolve(okChat('Nobody is listening.'));
    });
    await settle();
    expect(speakMock).not.toHaveBeenCalled();

    rerender(<Harness open />);
    await settle();
    postChatMock.mockResolvedValueOnce(okChat('Now someone is.'));
    await typeAndSend('second question');
    await settle();
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock.mock.calls[0][0]).toBe('Now someone is.');
  });

  it('a reply that arrives while the tab is hidden is not read aloud; the next one, after it is shown again, is', async () => {
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: true, disclosed: true }));
    await renderPanel();
    const chat = deferredChat();
    await typeAndSend('first question');
    const hidden = setHidden(true);
    try {
      await act(async () => {
        chat.resolve(okChat('Nobody is looking.'));
      });
      await settle();
      expect(speakMock).not.toHaveBeenCalled();
    } finally {
      hidden.mockRestore();
    }
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    postChatMock.mockResolvedValueOnce(okChat('Welcome back.'));
    await typeAndSend('second question');
    await settle();
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock.mock.calls[0][0]).toBe('Welcome back.');
  });
});

describe('ChatPanel voice: the speaker toggle needs a server voice', () => {
  it('is hidden when the Worker has none (there is no browser voice)', async () => {
    vi.mocked(fetchVoiceCaps).mockResolvedValue({ tts: 'none' });
    await renderPanel();
    expect(speakerToggle()).not.toBeInTheDocument();
  });

  it('is shown when it has one', async () => {
    vi.mocked(fetchVoiceCaps).mockResolvedValue({ tts: 'server' });
    await renderPanel();
    expect(speakerToggle()).toBeInTheDocument();
  });
});

// ---- The speaker toggle's label on touch devices -----------------------------

describe('ChatPanel voice: the speaker toggle', () => {
  it('shows "Sound off" / "Sound on" as text on a touch screen, while the name stays fixed and aria-pressed carries the state', async () => {
    const user = userEvent.setup();
    stubMatchMedia(['pointer: coarse']);
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: false, disclosed: false }));
    await renderPanel();
    const toggle = screen.getByRole('button', { name: 'Sound' });
    expect(toggle).toHaveTextContent('Sound off');
    // Label in name (WCAG 2.5.3): the accessible name is contained in the visible words.
    expect('Sound off'.toLowerCase()).toContain(toggle.getAttribute('aria-label')!.toLowerCase());
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle.querySelector('.thg-cc-speak-label')).toBeVisible();

    await user.click(toggle);
    // The very same button: its name did not change, so the state is announced once (by aria-pressed).
    expect(screen.getByRole('button', { name: 'Sound' })).toBe(toggle);
    expect(toggle).toHaveAccessibleName('Sound');
    expect(toggle).toHaveTextContent('Sound on');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // The words are for the eye; a screen reader gets the name and the pressed state, not both.
    expect(toggle.querySelector('.thg-cc-speak-label')).toHaveAttribute('aria-hidden', 'true');
  });

  it('has the same fixed name with a pointer, in both states', async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: false, disclosed: false }));
    await renderPanel();
    const toggle = screen.getByRole('button', { name: 'Sound' });
    await user.click(toggle);
    expect(toggle).toHaveAccessibleName('Sound');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('stays icon-only with a pointer, as before', async () => {
    await renderPanel();
    const toggle = speakerToggle()!;
    expect(toggle).toHaveAccessibleName(vc.VOICE_SPEAK_TOGGLE);
    expect(toggle.querySelector('.thg-cc-speak-label')).toBeNull();
    expect(screen.queryByText('Sound off')).not.toBeInTheDocument();
  });

  it('the labels are the copy the plan asked for', () => {
    expect(vc.VOICE_SOUND_ON).toBe('Sound on');
    expect(vc.VOICE_SOUND_OFF).toBe('Sound off');
  });
});

// ---- Audio the browser blocks: the pill --------------------------------------

describe('ChatPanel voice: "Tap to hear replies"', () => {
  const blob = () => new Blob([new Uint8Array(3)], { type: 'audio/mpeg' });

  const serverPanel = async () => {
    vi.mocked(fetchVoiceCaps).mockResolvedValue({ tts: 'server' });
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: true, disclosed: true }));
    return renderPanel();
  };

  const blockedReply = async () => {
    await typeAndSend('hello');
    await settle();
    const hooks = speakMock.mock.calls.at(-1)![1]!;
    act(() => hooks.onBlocked?.(blob()));
    await settle();
    return hooks;
  };

  it('appears under the reply that could not be played, as a blue 44 px button with the label and a speaker icon', async () => {
    await serverPanel();
    await blockedReply();
    const pill = screen.getByRole('button', { name: 'Tap to hear replies' });
    expect(pill).toHaveClass('thg-cc-sound-pill');
    expect(pill.closest('li')).toHaveTextContent('We help local businesses save time.');
    expect(pill.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(pill).toHaveAttribute('type', 'button');
    // Only the latest reply has one.
    expect(screen.getAllByRole('button', { name: 'Tap to hear replies' })).toHaveLength(1);
  });

  it('comes with the one-time "Sound is off until you tap." line under the composer', async () => {
    await serverPanel();
    await blockedReply();
    expect(screen.getByRole('alert')).toHaveTextContent('Sound is off until you tap.');
  });

  it('a tap plays that reply (synchronously, inside the tap) and the pill goes once it is playing', async () => {
    const user = userEvent.setup();
    await serverPanel();
    await blockedReply();
    await user.click(screen.getByRole('button', { name: 'Tap to hear replies' }));
    expect(speakBlobMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Tap to hear replies' })).toBeInTheDocument(); // not yet playing
    act(() => speakBlobMock.mock.calls[0][1]!.onStart?.('server'));
    await settle();
    expect(screen.queryByRole('button', { name: 'Tap to hear replies' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeEmptyDOMElement(); // "Sound is off until you tap." is over
    // Focus did not fall to the page when the button it was on went away.
    expect(document.activeElement).not.toBe(document.body);
  });

  it('is keyboard-operable like any button', async () => {
    const user = userEvent.setup();
    await serverPanel();
    await blockedReply();
    screen.getByRole('button', { name: 'Tap to hear replies' }).focus();
    await user.keyboard('{Enter}');
    expect(speakBlobMock).toHaveBeenCalledTimes(1);
  });

  it('typing instead of tapping leaves the pill only on the newest reply', async () => {
    await serverPanel();
    const first = await blockedReply();
    expect(first).toBeDefined();
    postChatMock.mockResolvedValueOnce(okChat('A newer reply.'));
    await typeAndSend('typed instead');
    await settle();
    expect(screen.queryByRole('button', { name: 'Tap to hear replies' })).not.toBeInTheDocument();
    act(() => speakMock.mock.calls.at(-1)![1]!.onBlocked?.(blob()));
    await settle();
    const pill = screen.getByRole('button', { name: 'Tap to hear replies' });
    expect(pill.closest('li')).toHaveTextContent('A newer reply.');
    expect(screen.getAllByRole('button', { name: 'Tap to hear replies' })).toHaveLength(1);
  });
});

// ---- The cap on spoken replies -----------------------------------------------

describe('ChatPanel voice: the cap on spoken replies', () => {
  const serverPanel = async () => {
    vi.mocked(fetchVoiceCaps).mockResolvedValue({ tts: 'server' });
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: true, disclosed: true }));
    return renderPanel();
  };

  const hitCap = async (bonusAvailable: boolean) => {
    await typeAndSend('hello');
    await settle();
    act(() => speakMock.mock.calls.at(-1)![1]!.onLimit?.(bonusAvailable));
    await settle();
  };

  it('with no bonus: one "done for today" notice, no chip, no speaker toggle', async () => {
    await serverPanel();
    expect(speakerToggle()).toBeInTheDocument();
    await hitCap(false);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Read-aloud is done for today. You can keep chatting here.'
    );
    expect(screen.queryByRole('button', { name: 'Share my details' })).not.toBeInTheDocument();
    expect(speakerToggle()).not.toBeInTheDocument();
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_error', { reason: 'budget' });
  });

  it('with a bonus: the paused notice and a "Share my details" chip stay under the composer while the visitor types', async () => {
    const user = userEvent.setup();
    await serverPanel();
    await hitCap(true);
    expect(
      screen.getByText("Read-aloud is paused. Share your name, email and number and we'll add 5 more today.")
    ).toBeInTheDocument();
    // The notice sits in the permanently mounted status region; the chip is next to it, not in it.
    const region = document.querySelector('.thg-cc-readaloud [role="status"]')!;
    expect(region).toHaveTextContent('Read-aloud is paused');
    expect(region).not.toContainElement(screen.getByRole('button', { name: 'Share my details' }));
    const chip = screen.getByRole('button', { name: 'Share my details' });
    expect(chip).toHaveClass('thg-cc-chip');
    expect(speakerToggle()).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'a');
    expect(screen.getByRole('button', { name: 'Share my details' })).toBeInTheDocument();
  });

  it('says how many replies the Worker named, in the notice and in the form', async () => {
    const user = userEvent.setup();
    await serverPanel();
    await typeAndSend('hello');
    await settle();
    act(() => speakMock.mock.calls.at(-1)![1]!.onLimit?.(true, 10));
    await settle();
    expect(screen.getByText(/we'll add 10 more today/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Share my details' }));
    expect(screen.getByText("Add your email and we'll add 10 more spoken replies today.")).toBeInTheDocument();
  });

  it('the chip opens the lead form with the email required; sending it brings spoken replies back', async () => {
    const user = userEvent.setup();
    postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
    await serverPanel();
    await hitCap(true);

    await user.click(screen.getByRole('button', { name: 'Share my details' }));
    const form = screen.getByRole('form', { name: 'Callback request' });
    expect(within(form).getByText("Add your email and we'll add 5 more spoken replies today.")).toBeInTheDocument();
    expect(within(form).getByLabelText('Email')).toHaveAttribute('aria-required', 'true');
    expect(within(form).queryByLabelText('Email (optional)')).not.toBeInTheDocument();
    // The chat's own box and the notice are out of the way while the form is up.
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();

    // Without an email it will not go.
    await user.type(within(form).getByLabelText('Name'), 'Jane Doe');
    await user.type(within(form).getByLabelText('Phone'), '(770) 555-1234');
    await user.type(within(form).getByLabelText('Business name'), 'Doe Plumbing');
    await user.selectOptions(within(form).getByLabelText('Best callback window'), 'afternoon_1_3');
    await user.click(within(form).getByLabelText(copy.CONSENT));
    await user.click(within(form).getByRole('button', { name: /request my callback/i }));
    expect(postLeadMock).not.toHaveBeenCalled();
    expect(within(form).getByText('Enter your email so we can add your replies')).toBeInTheDocument();

    await user.type(within(form).getByLabelText('Email'), 'jane@doe.example');
    await user.click(within(form).getByRole('button', { name: /request my callback/i }));
    await settle();
    expect(postLeadMock).toHaveBeenCalledTimes(1);

    // The notice and chip are gone, the toggle is back, and the next reply is requested and spoken.
    expect(screen.queryByRole('button', { name: 'Share my details' })).not.toBeInTheDocument();
    expect(speakerToggle()).toBeInTheDocument();
    speakMock.mockClear();
    postChatMock.mockResolvedValueOnce(okChat('Spoken again.'));
    await typeAndSend('one more');
    await settle();
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock.mock.calls[0][0]).toBe('Spoken again.');
  });

  it('a normal callback request without an email takes the chip away for good: it never sits there doing nothing', async () => {
    const user = userEvent.setup();
    postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
    // The reply that hits the cap also offers a callback ("Yes, call me").
    postChatMock.mockResolvedValueOnce({
      kind: 'ok',
      data: {
        reply: 'Want us to call you?',
        intent: 'answer',
        offerCallback: true,
        readyToConfirm: false,
        lead: { ...EMPTY_LEAD_DRAFT },
      },
    });
    await serverPanel();
    await hitCap(true);
    expect(screen.getByRole('button', { name: 'Share my details' })).toBeInTheDocument();

    // The visitor takes that ordinary offer instead, and leaves the email blank.
    await user.click(screen.getByRole('button', { name: copy.OFFER_YES }));
    const form = screen.getByRole('form', { name: 'Callback request' });
    expect(within(form).getByLabelText('Email (optional)')).toBeInTheDocument();
    await user.type(within(form).getByLabelText('Name'), 'Jane Doe');
    await user.type(within(form).getByLabelText('Phone'), '(770) 555-1234');
    await user.type(within(form).getByLabelText('Business name'), 'Doe Plumbing');
    await user.selectOptions(within(form).getByLabelText('Best callback window'), 'afternoon_1_3');
    await user.click(within(form).getByLabelText(copy.CONSENT));
    await user.click(within(form).getByRole('button', { name: /request my callback/i }));
    await settle();
    expect(postLeadMock).toHaveBeenCalledTimes(1);

    expect(screen.queryByRole('button', { name: 'Share my details' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Read-aloud is paused/)).not.toBeInTheDocument();
    expect(speakerToggle()).not.toBeInTheDocument(); // still capped
  });

  it('"Not now, keep chatting" brings the composer back and the notice with it', async () => {
    const user = userEvent.setup();
    await serverPanel();
    await hitCap(true);
    await user.click(screen.getByRole('button', { name: 'Share my details' }));
    await user.click(screen.getByRole('button', { name: copy.LEAD_FORM_DISMISS }));
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share my details' })).toBeInTheDocument();
  });
});
