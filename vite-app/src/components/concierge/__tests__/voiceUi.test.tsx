import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatResult, SttResult } from '../api';
import type { Recording, RecordingResult } from '../voice/recorder';

vi.mock('../api', () => ({
  postChat: vi.fn(),
  postLead: vi.fn(),
  postStt: vi.fn(),
  fetchTts: vi.fn(),
  fetchVoiceCaps: vi.fn(),
}));
vi.mock('../turnstile', () => ({ getToken: vi.fn() }));
vi.mock('../../../lib/track', () => ({ track: vi.fn() }));
vi.mock('../../../hooks/useLenis', () => ({ getLenis: vi.fn() }));
vi.mock('../voice/recorder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../voice/recorder')>()),
  isRecordingSupported: vi.fn(),
  startRecording: vi.fn(),
}));
vi.mock('../voice/speech', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../voice/speech')>()),
  speak: vi.fn(),
  speakBlob: vi.fn(),
  stopSpeaking: vi.fn(),
  unlockSpeech: vi.fn(),
  isSpeechSupported: vi.fn(),
}));

import ChatPanel, { type OpenRequest } from '../ChatPanel';
import Composer from '../Composer';
import Equalizer from '../Equalizer';
import MicButton from '../MicButton';
import { fetchVoiceCaps, postChat, postLead, postStt } from '../api';
import { getToken } from '../turnstile';
import { track } from '../../../lib/track';
import { isRecordingSupported, startRecording, VoiceError } from '../voice/recorder';
import { isSpeechSupported, speak, speakBlob, stopSpeaking, unlockSpeech } from '../voice/speech';
import { EMPTY_LEAD_DRAFT } from '../leadDraft';
import { VOICE_PREFS_KEY } from '../voice/prefs';
import * as vc from '../voice/copy';
import * as copy from '../copy';

const supportedMock = vi.mocked(isRecordingSupported);
const startRecordingMock = vi.mocked(startRecording);
const speakMock = vi.mocked(speak);
const stopSpeakingMock = vi.mocked(stopSpeaking);
const unlockMock = vi.mocked(unlockSpeech);
const speakBlobMock = vi.mocked(speakBlob);
const postLeadMock = vi.mocked(postLead);
const postSttMock = vi.mocked(postStt);
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
const okStt = (text: string): SttResult => ({ kind: 'ok', text, durationMs: 3000 });

function fakeRecording(durationMs = 3000, mime = 'audio/webm;codecs=opus') {
  let resolve!: (value: RecordingResult | null) => void;
  const result = new Promise<RecordingResult | null>((r) => {
    resolve = r;
  });
  const blob = new Blob([new Uint8Array(4)], { type: mime });
  const recording: Recording = {
    result,
    stop: vi.fn(() => resolve({ blob, mime, durationMs })),
    cancel: vi.fn(() => resolve(null)),
  };
  return { recording, blob, finish: resolve };
}

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
  postSttMock.mockResolvedValue(okStt('what do you do'));
  vi.mocked(fetchVoiceCaps).mockResolvedValue({ tts: 'browser' });
  vi.mocked(isSpeechSupported).mockReturnValue(true);
  supportedMock.mockReturnValue(false);
  startRecordingMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.style.overflow = '';
});

// ---- MicButton ---------------------------------------------------------------

describe('MicButton', () => {
  const setup = (props: Partial<Parameters<typeof MicButton>[0]> = {}) => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const onUnlock = vi.fn();
    const utils = render(
      <MicButton
        state="idle"
        ending={false}
        touch={false}
        busy={false}
        disabled={false}
        onStart={onStart}
        onStop={onStop}
        onUnlock={onUnlock}
        {...props}
      />
    );
    const rerender = (next: Partial<Parameters<typeof MicButton>[0]>) =>
      utils.rerender(
        <MicButton
          state="idle"
          ending={false}
          touch={false}
          busy={false}
          disabled={false}
          onStart={onStart}
          onStop={onStop}
          onUnlock={onUnlock}
          {...props}
          {...next}
        />
      );
    return { onStart, onStop, onUnlock, rerender, button: screen.getByRole('button') };
  };

  it('is a labelled toggle button: "Click to talk" with a pointer, "Hold to talk" on touch', () => {
    const desktop = setup();
    expect(desktop.button).toHaveAccessibleName(vc.VOICE_BUTTON_DESKTOP);
    expect(desktop.button).toHaveAttribute('type', 'button');
    expect(desktop.button).toHaveAttribute('aria-pressed', 'false');
  });

  it('is labelled "Hold to talk" on a touch screen', () => {
    const { button } = setup({ touch: true });
    expect(button).toHaveAccessibleName(vc.VOICE_BUTTON);
  });

  it('a click starts, a second click stops (aria-pressed follows)', async () => {
    const user = userEvent.setup();
    const { onStart, onStop, rerender, button } = setup();
    await user.click(button);
    expect(onStart).toHaveBeenCalledWith({ hold: false });

    rerender({ state: 'recording' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAccessibleName(vc.VOICE_BUTTON_DESKTOP); // the name stays; pressed says the rest
    expect(button).toHaveAttribute('title', vc.VOICE_STOP);
    await user.click(button);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('the Space bar and Enter toggle it when focused', async () => {
    const user = userEvent.setup();
    const { onStart, button } = setup();
    button.focus();
    await user.keyboard(' ');
    expect(onStart).toHaveBeenCalledTimes(1);
    await user.keyboard('{Enter}');
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it('touch: pressing starts, letting go stops, and the click that follows does not toggle again', () => {
    const { onStart, onStop, button } = setup({ touch: true });
    fireEvent.pointerDown(button, { pointerType: 'touch', pointerId: 1, button: 0 });
    expect(onStart).toHaveBeenCalledWith({ hold: true });
    fireEvent.pointerUp(button, { pointerType: 'touch', pointerId: 1 });
    expect(onStop).toHaveBeenCalledTimes(1);
    fireEvent.click(button, { detail: 1 }); // the synthesized click after a touch
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('touch: a cancelled press (the system took the touch) also stops', () => {
    const { onStart, onStop, button } = setup({ touch: true });
    fireEvent.pointerDown(button, { pointerType: 'touch', pointerId: 1, button: 0 });
    fireEvent.pointerCancel(button, { pointerType: 'touch', pointerId: 1 });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('a keyboard or screen-reader activation still toggles right after a touch', () => {
    const { onStart, button } = setup({ touch: true });
    fireEvent.pointerDown(button, { pointerType: 'touch', pointerId: 1, button: 0 });
    fireEvent.pointerUp(button, { pointerType: 'touch', pointerId: 1 });
    fireEvent.click(button, { detail: 0 });
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it('unlocks speech inside every gesture: a touch press, its release (iOS counts the release, not the press), and a click', async () => {
    const user = userEvent.setup();
    const touch = setup({ touch: true });
    fireEvent.pointerDown(touch.button, { pointerType: 'touch', pointerId: 1, button: 0 });
    expect(touch.onUnlock).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(touch.button, { pointerType: 'touch', pointerId: 1 });
    expect(touch.onUnlock).toHaveBeenCalledTimes(2);
    document.body.innerHTML = '';

    const mouse = setup();
    await user.click(mouse.button);
    expect(mouse.onUnlock).toHaveBeenCalledTimes(1);
    document.body.innerHTML = '';

    // A press that is ignored (a reply is pending) is not a gesture worth unlocking for.
    const busy = setup({ busy: true });
    fireEvent.pointerDown(busy.button, { pointerType: 'touch', pointerId: 1, button: 0 });
    await user.click(busy.button);
    expect(busy.onUnlock).not.toHaveBeenCalled();
  });

  it('a mouse press does not start anything until the click', () => {
    const { onStart, button } = setup();
    fireEvent.pointerDown(button, { pointerType: 'mouse', pointerId: 1, button: 0 });
    expect(onStart).not.toHaveBeenCalled();
  });

  it('suppresses the long-press context menu', () => {
    const { button } = setup({ touch: true });
    expect(fireEvent.contextMenu(button)).toBe(false);
  });

  it('while a reply is pending or a transcript is coming it ignores presses but stays focusable', async () => {
    const user = userEvent.setup();
    for (const props of [{ busy: true }, { state: 'transcribing' as const }]) {
      const { onStart, onStop, button } = setup(props);
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).not.toBeDisabled();
      await user.click(button);
      fireEvent.pointerDown(button, { pointerType: 'touch', pointerId: 1, button: 0 });
      expect(onStart).not.toHaveBeenCalled();
      expect(onStop).not.toHaveBeenCalled();
      document.body.innerHTML = '';
    }
  });

  it('is disabled once the chat has ended', () => {
    const { button } = setup({ disabled: true });
    expect(button).toBeDisabled();
  });

  it('shows a countdown ring and a ticking number in the last seconds, hidden from screen readers', () => {
    vi.useFakeTimers();
    const { button, rerender } = setup({ state: 'recording' });
    expect(button.querySelector('.thg-cc-ring')).toBeNull();
    rerender({ state: 'recording', ending: true });
    const ring = button.querySelector('.thg-cc-ring');
    expect(ring).not.toBeNull();
    expect(ring).toHaveAttribute('aria-hidden', 'true');
    const count = button.querySelector('.thg-cc-count') as HTMLElement;
    expect(count).toHaveAttribute('aria-hidden', 'true');
    expect(count.textContent).toBe('5');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(count.textContent).toBe('4');
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(count.textContent).toBe('1');
  });
});

// ---- Equalizer ---------------------------------------------------------------

describe('Equalizer', () => {
  it('listening: decorative bars whose height follows the level without re-rendering', () => {
    let listener: ((level: number) => void) | null = null;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((l: (level: number) => void) => {
      listener = l;
      return unsubscribe;
    });
    const { container, unmount } = render(
      <Equalizer mode="listening" subscribeLevel={subscribe} />
    );
    const eq = container.querySelector('.thg-cc-eq') as HTMLElement;
    expect(eq).toHaveAttribute('aria-hidden', 'true');
    expect(eq).toHaveAttribute('data-mode', 'listening');
    expect(eq.querySelectorAll('i')).toHaveLength(5);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    act(() => listener!(0.5));
    expect(eq.style.getPropertyValue('--thg-cc-level')).toBe('0.5');
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('speaking: a button that stops the reading', async () => {
    const onStop = vi.fn();
    const user = userEvent.setup();
    render(<Equalizer mode="speaking" subscribeLevel={() => () => {}} onStop={onStop} />);
    const button = screen.getByRole('button', { name: vc.VOICE_STOP_SPEAKING });
    expect(button).toHaveAttribute('data-mode', 'speaking');
    await user.click(button);
    expect(onStop).toHaveBeenCalledTimes(1);
    button.focus();
    await user.keyboard(' ');
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it('transcribing: still bars', () => {
    const { container } = render(<Equalizer mode="transcribing" subscribeLevel={() => () => {}} />);
    expect(container.querySelector('.thg-cc-eq')).toHaveAttribute('data-mode', 'working');
  });

  it('reduced motion: marked as such and never listens to the level', () => {
    stubMatchMedia(['prefers-reduced-motion']);
    const subscribe = vi.fn(() => () => {});
    const { container } = render(<Equalizer mode="listening" subscribeLevel={subscribe} />);
    expect(container.querySelector('.thg-cc-eq')).toHaveAttribute('data-motion', 'reduced');
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('full motion is the default', () => {
    const { container } = render(<Equalizer mode="speaking" subscribeLevel={() => () => {}} />);
    expect(container.querySelector('.thg-cc-eq')).not.toHaveAttribute('data-motion');
  });
});

// ---- Composer ----------------------------------------------------------------

describe('Composer with voice', () => {
  const voice = (over: Partial<NonNullable<Parameters<typeof Composer>[0]['voice']>> = {}) => ({
    state: 'idle' as const,
    ending: false,
    disclosed: false,
    touch: false,
    onStart: vi.fn(),
    onStop: vi.fn(),
    onUnlock: vi.fn(),
    ...over,
  });
  const setup = (v: ReturnType<typeof voice> | undefined, extra: Partial<Parameters<typeof Composer>[0]> = {}) =>
    render(
      <Composer onSend={vi.fn()} busy={false} disabled={false} error={null} voice={v} {...extra} />
    );

  it('has no mic without voice, or when voice is off', () => {
    setup(undefined);
    expect(screen.queryByRole('button', { name: /talk/i })).not.toBeInTheDocument();
    document.body.innerHTML = '';
    setup(voice({ state: 'off' }));
    expect(screen.queryByRole('button', { name: /talk/i })).not.toBeInTheDocument();
  });

  it('puts the mic between the text box and the Send button', () => {
    setup(voice());
    const mic = screen.getByRole('button', { name: vc.VOICE_BUTTON_DESKTOP });
    const send = screen.getByRole('button', { name: 'Send message' });
    const box = screen.getByRole('textbox', { name: 'Message' });
    expect(box.compareDocumentPosition(mic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mic.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mic.parentElement).toBe(send.parentElement);
  });

  it('announces what the microphone is doing', () => {
    const { rerender } = setup(voice({ state: 'recording' }));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(vc.VOICE_LISTENING);
    rerender(
      <Composer onSend={vi.fn()} busy={false} disabled={false} error={null} voice={voice({ state: 'transcribing' })} />
    );
    expect(screen.getByRole('status')).toHaveTextContent(vc.VOICE_TRANSCRIBING);
    rerender(
      <Composer onSend={vi.fn()} busy={false} disabled={false} error={null} voice={voice({ state: 'recording', ending: true })} />
    );
    expect(screen.getByRole('status')).toHaveTextContent(vc.VOICE_ENDING_SOON);
    rerender(
      <Composer onSend={vi.fn()} busy={false} disabled={false} error={null} voice={voice()} />
    );
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('shows the microphone disclosure under the composer once voice has been used, and ties it to the mic', () => {
    const { rerender } = setup(voice());
    expect(screen.queryByText(vc.VOICE_DISCLOSURE)).not.toBeInTheDocument();
    rerender(
      <Composer onSend={vi.fn()} busy={false} disabled={false} error={null} voice={voice({ disclosed: true })} />
    );
    expect(screen.getByText(vc.VOICE_DISCLOSURE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: vc.VOICE_BUTTON_DESKTOP })).toHaveAccessibleDescription(
      vc.VOICE_DISCLOSURE
    );
  });

  it('shows a voice notice in the alert line without calling the text box invalid', () => {
    setup(voice(), { notice: vc.VOICE_DENIED });
    expect(screen.getByRole('alert')).toHaveTextContent(vc.VOICE_DENIED);
    expect(screen.getByRole('textbox', { name: 'Message' })).not.toHaveAttribute('aria-invalid');
    document.body.innerHTML = '';
    // A real typing problem still does.
    setup(voice(), { error: 'Too long', notice: vc.VOICE_DENIED });
    expect(screen.getByRole('alert')).toHaveTextContent('Too long');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('passes presses up, and typing still works', async () => {
    const user = userEvent.setup();
    const v = voice();
    setup(v);
    await user.click(screen.getByRole('button', { name: vc.VOICE_BUTTON_DESKTOP }));
    expect(v.onStart).toHaveBeenCalledWith({ hold: false });
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hi');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('the mic goes quiet when a reply is pending and disabled when the chat has ended', () => {
    setup(voice(), { busy: true });
    expect(screen.getByRole('button', { name: vc.VOICE_BUTTON_DESKTOP })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    document.body.innerHTML = '';
    setup(voice(), { disabled: true });
    expect(screen.getByRole('button', { name: vc.VOICE_BUTTON_DESKTOP })).toBeDisabled();
  });
});

// ---- The panel, end to end (recorder, speech and Worker mocked) --------------

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
  supportedMock.mockReturnValue(true);
  const utils = render(<Harness {...props} />);
  await settle();
  return utils;
};

const mic = () => screen.queryByRole('button', { name: /^(Click|Hold) to talk$/ });
const speakerToggle = () => screen.queryByRole('button', { name: vc.VOICE_SPEAK_TOGGLE });

describe('ChatPanel voice', () => {
  it('shows no voice controls in a browser that cannot record', async () => {
    supportedMock.mockReturnValue(false);
    render(<Harness />);
    await settle();
    expect(mic()).not.toBeInTheDocument();
    expect(speakerToggle()).not.toBeInTheDocument();
    expect(vi.mocked(fetchVoiceCaps)).not.toHaveBeenCalled();
    // The text chat is untouched.
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  });

  it('shows no voice controls when the Worker has no speech to text', async () => {
    vi.mocked(fetchVoiceCaps).mockResolvedValue(null);
    await renderPanel();
    expect(mic()).not.toBeInTheDocument();
    expect(speakerToggle()).not.toBeInTheDocument();
  });

  it('shows the mic in the composer and the speaker toggle in the header when voice is on', async () => {
    await renderPanel();
    const button = mic()!;
    expect(button).toBeInTheDocument();
    expect(button.closest('.thg-cc-composer')).not.toBeNull();
    const toggle = speakerToggle()!;
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle.closest('.thg-cc-header')).not.toBeNull();
  });

  it('click to talk, click to stop: the transcript becomes the visitor\'s message and the reply arrives', async () => {
    const user = userEvent.setup();
    const rec = fakeRecording();
    startRecordingMock.mockResolvedValue(rec.recording);
    await renderPanel();

    await user.click(mic()!);
    await settle();
    expect(mic()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(vc.VOICE_LISTENING);
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_start');

    await user.click(mic()!);
    await settle();

    expect(postSttMock).toHaveBeenCalledTimes(1);
    expect(postChatMock).toHaveBeenCalledTimes(1);
    const log = screen.getByRole('log', { name: 'Conversation' });
    expect(within(log).getByText('what do you do')).toBeInTheDocument();
    expect(within(log).getByText('We help local businesses save time.')).toBeInTheDocument();
    expect(mic()).toHaveAttribute('aria-pressed', 'false');
    // First voice use: the disclosure line appears and replies are read aloud.
    expect(screen.getByText(vc.VOICE_DISCLOSURE)).toBeInTheDocument();
    expect(speakerToggle()).toHaveAttribute('aria-pressed', 'true');
    expect(speakMock).toHaveBeenCalledWith(
      'We help local businesses save time.',
      'browser',
      expect.anything()
    );
  });

  it('an empty transcript shows the "didn\'t catch that" copy and sends nothing', async () => {
    const user = userEvent.setup();
    postSttMock.mockResolvedValue(okStt(''));
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await renderPanel();
    await user.click(mic()!);
    await settle();
    await user.click(mic()!);
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(vc.VOICE_HEARD_NOTHING);
    expect(postChatMock).not.toHaveBeenCalled();
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_empty');
  });

  it('a refused microphone shows the blocked copy and records the event', async () => {
    const user = userEvent.setup();
    startRecordingMock.mockRejectedValue(new VoiceError('permission'));
    await renderPanel();
    await user.click(mic()!);
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(vc.VOICE_DENIED);
    expect(screen.getByRole('textbox', { name: 'Message' })).not.toHaveAttribute('aria-invalid');
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_error', { reason: 'permission' });
    // Typing still works, and the mic is still there for another try.
    expect(mic()).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hello{Enter}');
    await settle();
    expect(postChatMock).toHaveBeenCalledTimes(1);
  });

  it('voice_unavailable takes the mic and the speaker toggle away for the session, with one explanation', async () => {
    const user = userEvent.setup();
    postSttMock.mockResolvedValue({ kind: 'voice_unavailable', reason: 'budget' });
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await renderPanel();
    await user.click(mic()!);
    await settle();
    await user.click(mic()!);
    await settle();
    expect(mic()).not.toBeInTheDocument();
    expect(speakerToggle()).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(vc.VOICE_OFF);
    // Focus is not lost to the page body.
    expect(document.activeElement).not.toBe(document.body);
    // The text chat carries on.
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hello{Enter}');
    await settle();
    expect(postChatMock).toHaveBeenCalledTimes(1);
  });

  it('the speaker toggle flips, and is remembered when the panel is built again in the same tab', async () => {
    const user = userEvent.setup();
    const first = await renderPanel();
    await user.click(speakerToggle()!);
    expect(speakerToggle()).toHaveAttribute('aria-pressed', 'true');
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

    const hooks = speakMock.mock.calls[0][2]!;
    act(() => hooks.onStart?.('browser'));
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

  it('the header equalizer shows while listening, as decoration', async () => {
    const user = userEvent.setup();
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await renderPanel();
    await user.click(mic()!);
    await settle();
    const eq = document.querySelector('.thg-cc-eq')!;
    expect(eq).toHaveAttribute('data-mode', 'listening');
    expect(eq).toHaveAttribute('aria-hidden', 'true');
    expect(eq.closest('.thg-cc-header')).not.toBeNull();
  });

  it('reduced motion is passed to the equalizer', async () => {
    const user = userEvent.setup();
    stubMatchMedia(['prefers-reduced-motion']);
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await renderPanel();
    await user.click(mic()!);
    await settle();
    expect(document.querySelector('.thg-cc-eq')).toHaveAttribute('data-motion', 'reduced');
  });

  it('on a touch screen the mic is the hold-to-talk kind', async () => {
    stubMatchMedia(['pointer: coarse']);
    await renderPanel();
    expect(screen.getByRole('button', { name: vc.VOICE_BUTTON })).toBeInTheDocument();
  });

  it('closing the panel releases the microphone', async () => {
    const user = userEvent.setup();
    const rec = fakeRecording();
    startRecordingMock.mockResolvedValue(rec.recording);
    const { rerender } = await renderPanel();
    await user.click(mic()!);
    await settle();
    expect(rec.recording.cancel).not.toHaveBeenCalled();

    supportedMock.mockReturnValue(true);
    rerender(<Harness open={false} />);
    await settle();
    expect(rec.recording.cancel).toHaveBeenCalledTimes(1);
    expect(stopSpeakingMock).toHaveBeenCalled();
    expect(postSttMock).not.toHaveBeenCalled();
  });

  it('hiding the page (switching tabs) releases the microphone but leaves the reading alone', async () => {
    const user = userEvent.setup();
    const rec = fakeRecording();
    startRecordingMock.mockResolvedValue(rec.recording);
    await renderPanel();
    await user.click(mic()!);
    await settle();
    stopSpeakingMock.mockClear();

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();
    } finally {
      hidden.mockRestore();
    }
    expect(rec.recording.cancel).toHaveBeenCalledTimes(1);
    expect(stopSpeakingMock).not.toHaveBeenCalled();
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
  it('unmounting the panel mid-recording stops the microphone and discards the clip', async () => {
    const user = userEvent.setup();
    const rec = fakeRecording();
    startRecordingMock.mockResolvedValue(rec.recording);
    const { unmount } = await renderPanel();
    await user.click(mic()!);
    await settle();
    expect(rec.recording.cancel).not.toHaveBeenCalled();

    unmount();
    await settle();
    expect(rec.recording.cancel).toHaveBeenCalledTimes(1);
    expect(postSttMock).not.toHaveBeenCalled();
    expect(stopSpeakingMock).toHaveBeenCalled();
  });

  it('a reply that arrives after the panel was closed is not read aloud; it is, once the panel is open again', async () => {
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: true, disclosed: true }));
    const { rerender } = await renderPanel();
    const chat = deferredChat();
    await typeAndSend('first question');
    supportedMock.mockReturnValue(true);
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

  it('hiding the tab while a transcript is on its way does not lose the question', async () => {
    const user = userEvent.setup();
    let resolveStt!: (r: SttResult) => void;
    postSttMock.mockReturnValue(
      new Promise((r) => {
        resolveStt = r;
      })
    );
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await renderPanel();
    await user.click(mic()!);
    await settle();
    await user.click(mic()!);
    await settle();

    const hidden = setHidden(true);
    try {
      await settle();
      await act(async () => {
        resolveStt(okStt('what do you do'));
      });
      await settle();
    } finally {
      hidden.mockRestore();
    }
    expect(postChatMock).toHaveBeenCalledTimes(1);
    const log = screen.getByRole('log', { name: 'Conversation' });
    expect(within(log).getByText('what do you do')).toBeInTheDocument();
  });
});

describe('ChatPanel voice: unlocking speech inside a gesture', () => {
  it('a touch press-and-hold unlocks on the release as well as the press', async () => {
    stubMatchMedia(['pointer: coarse']);
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await renderPanel();
    const button = screen.getByRole('button', { name: vc.VOICE_BUTTON });
    fireEvent.pointerDown(button, { pointerType: 'touch', pointerId: 1, button: 0 });
    await settle();
    const afterPress = unlockMock.mock.calls.length;
    expect(afterPress).toBeGreaterThan(0);
    fireEvent.pointerUp(button, { pointerType: 'touch', pointerId: 1 });
    expect(unlockMock.mock.calls.length).toBe(afterPress + 1);
  });
});

describe('ChatPanel voice: the microphone line', () => {
  it('uses the new wording, shows from the first use, and is gone when the panel is reopened', async () => {
    const user = userEvent.setup();
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    const { rerender } = await renderPanel();
    expect(screen.queryByText(vc.VOICE_DISCLOSURE)).not.toBeInTheDocument();
    await user.click(mic()!);
    await settle();
    expect(screen.getByText("Voice uses your microphone only while you're recording. Audio isn't stored.")).toBeInTheDocument();

    supportedMock.mockReturnValue(true);
    rerender(<Harness open={false} />);
    await settle();
    rerender(<Harness open />);
    await settle();
    expect(screen.queryByText(vc.VOICE_DISCLOSURE)).not.toBeInTheDocument();
  });

  it('a refused first press shows no line and leaves reading aloud off', async () => {
    const user = userEvent.setup();
    startRecordingMock.mockRejectedValue(new VoiceError('permission'));
    await renderPanel();
    await user.click(mic()!);
    await settle();
    expect(screen.queryByText(vc.VOICE_DISCLOSURE)).not.toBeInTheDocument();
    expect(speakerToggle()).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('ChatPanel voice: the last seconds', () => {
  it('says "Ending soon" in words while the ring runs', async () => {
    const user = userEvent.setup();
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await renderPanel();
    await user.click(mic()!);
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent(vc.VOICE_LISTENING);
    act(() => startRecordingMock.mock.calls[0][0]!.onEnding?.());
    expect(screen.getByRole('status')).toHaveTextContent('Ending soon');
    expect(mic()!.querySelector('.thg-cc-ring')).not.toBeNull();
  });
});

describe('ChatPanel voice: the speaker toggle', () => {
  it('is hidden where nothing can read replies aloud', async () => {
    vi.mocked(isSpeechSupported).mockReturnValue(false);
    await renderPanel();
    expect(mic()).toBeInTheDocument();
    expect(speakerToggle()).not.toBeInTheDocument();
  });

  it('is shown with the server voice even where the browser cannot speak', async () => {
    vi.mocked(isSpeechSupported).mockReturnValue(false);
    vi.mocked(fetchVoiceCaps).mockResolvedValue({ tts: 'server' });
    await renderPanel();
    expect(speakerToggle()).toBeInTheDocument();
  });
});

// ---- The speaker toggle's label on touch devices -----------------------------

describe('ChatPanel voice: the speaker toggle', () => {
  it('shows "Sound off" / "Sound on" as text on a touch screen, and the name says the same', async () => {
    const user = userEvent.setup();
    stubMatchMedia(['pointer: coarse']);
    await renderPanel();
    let toggle = screen.getByRole('button', { name: 'Sound off, read replies aloud' });
    expect(toggle).toHaveTextContent('Sound off');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle.querySelector('.thg-cc-speak-label')).toBeVisible();

    await user.click(toggle);
    toggle = screen.getByRole('button', { name: 'Sound on, read replies aloud' });
    expect(toggle).toHaveTextContent('Sound on');
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
    const hooks = speakMock.mock.calls.at(-1)![2]!;
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
    act(() => speakMock.mock.calls.at(-1)![2]!.onBlocked?.(blob()));
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
    act(() => speakMock.mock.calls.at(-1)![2]!.onLimit?.(bonusAvailable));
    await settle();
  };

  it('with no bonus: one "done for today" notice, no chip, no speaker toggle, and the mic stays', async () => {
    await serverPanel();
    expect(speakerToggle()).toBeInTheDocument();
    await hitCap(false);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Read-aloud is done for today. You can keep chatting here.'
    );
    expect(screen.queryByRole('button', { name: 'Share my details' })).not.toBeInTheDocument();
    expect(speakerToggle()).not.toBeInTheDocument();
    expect(mic()).toBeInTheDocument();
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_error', { reason: 'budget' });
  });

  it('with a bonus: the paused notice and a "Share my details" chip stay under the composer while the visitor types', async () => {
    const user = userEvent.setup();
    await serverPanel();
    await hitCap(true);
    expect(
      screen.getByText("Read-aloud is paused. Share your name, email and number and we'll add 5 more today.")
    ).toBeInTheDocument();
    const chip = screen.getByRole('button', { name: 'Share my details' });
    expect(chip).toHaveClass('thg-cc-chip');
    expect(speakerToggle()).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'a');
    expect(screen.getByRole('button', { name: 'Share my details' })).toBeInTheDocument();
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
