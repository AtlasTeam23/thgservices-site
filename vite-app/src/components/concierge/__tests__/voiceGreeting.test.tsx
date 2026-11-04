import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatResult } from '../api';

// Everything real (the bubble, the lazy panel, the controller, the speech module, the storage) except the
// network, the microphone, analytics and the <audio> element, which is a fake that records what was played.
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
  isRecordingSupported: vi.fn(() => true),
  startRecording: vi.fn(),
}));

import ChatBubble from '../ChatBubble';
import { Concierge, openConcierge } from '../index';
import { fetchTts, fetchVoiceCaps, postChat } from '../api';
import { track } from '../../../lib/track';
import * as copy from '../copy';
import { EMPTY_LEAD_DRAFT } from '../leadDraft';
import { STORAGE_KEY } from '../storage';
import { GREETING_URL, resetGreeting } from '../voice/greeting';
import { VOICE_PREFS_KEY } from '../voice/prefs';
import { resetSpeech } from '../voice/speech';
import * as vc from '../voice/copy';

class FakeAudio {
  static instances: FakeAudio[] = [];
  static playImpl: (audio: FakeAudio) => Promise<void> = async () => {};
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(() => FakeAudio.playImpl(this));
  pause = vi.fn();
  constructor() {
    FakeAudio.instances.push(this);
  }
}

const notAllowed = () => new DOMException('The request is not allowed', 'NotAllowedError');

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

const storedPrefs = () => JSON.parse(window.sessionStorage.getItem(VOICE_PREFS_KEY) ?? 'null');
const setPrefs = (prefs: Record<string, unknown>) =>
  window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(prefs));

const message = (role: 'user' | 'assistant', content: string, greeting = false) => ({
  id: crypto.randomUUID(),
  role,
  content,
  at: new Date().toISOString(),
  ...(greeting ? { greeting: true } : {}),
});
const seedThread = (messages: ReturnType<typeof message>[]) =>
  window.sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ sessionId: crypto.randomUUID(), messages, leadSubmitted: false, ended: false, utm: {} })
  );

/** The page has loaded and the Worker has answered /health. */
const loadPage = async () => {
  const utils = render(<Concierge />);
  await settle();
  return utils;
};

const bubble = () => screen.getByRole('button', { name: copy.BUBBLE_LABEL });
const clickBubble = () => fireEvent.click(bubble());
const audio = () => FakeAudio.instances[0];
const equalizer = () => screen.queryByRole('button', { name: vc.VOICE_STOP_SPEAKING });

beforeEach(() => {
  vi.clearAllMocks();
  resetSpeech();
  resetGreeting();
  window.sessionStorage.clear();
  FakeAudio.instances = [];
  FakeAudio.playImpl = async () => {};
  vi.stubGlobal('Audio', FakeAudio);
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  vi.mocked(fetchVoiceCaps).mockResolvedValue({ tts: 'server' });
  vi.mocked(postChat).mockResolvedValue(okChat('A reply to read aloud.'));
  vi.mocked(fetchTts).mockResolvedValue({ kind: 'ok', blob: new Blob([new Uint8Array([1, 2, 3])]) });
});

afterEach(() => {
  resetSpeech();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the greeting plays when the chat is opened', () => {
  it('starts inside the click, before the panel chunk has loaded', async () => {
    await loadPage();
    clickBubble();

    // Synchronously, in the same click: the panel is not there yet, but the shared audio element is
    // already playing the recording (this is what iOS needs, and why it cannot wait for the panel).
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(FakeAudio.instances).toHaveLength(1);
    expect(audio().src).toBe(GREETING_URL);
    expect(audio().src).toBe('/concierge/greeting.mp3');
    expect(audio().play).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    await screen.findByRole('dialog', { name: copy.PANEL_TITLE });
    await settle();
    expect(screen.getByText(copy.GREETING)).toBeInTheDocument();
    expect(audio().play).toHaveBeenCalledTimes(1); // the panel did not start it again
  });

  it('works from every way of opening the chat', async () => {
    await loadPage();
    act(() => openConcierge({ source: 'section_cta' }));
    expect(audio().play).toHaveBeenCalledTimes(1);
    expect(audio().src).toBe(GREETING_URL);
    await screen.findByRole('dialog');
  });

  it('does not wait for the panel at all: it plays even if the chunk never arrives', async () => {
    render(<ChatBubble panelLoader={() => new Promise(() => {})} />);
    await settle();
    clickBubble();
    expect(audio().play).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Loading chat…')).toBeInTheDocument();
  });

  it('stops again if the panel chunk fails to load, since nobody can see what it says', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ChatBubble panelLoader={() => Promise.reject(new Error('Failed to fetch dynamically imported module'))} />);
    await settle();
    clickBubble();
    expect(audio().play).toHaveBeenCalledTimes(1);
    await screen.findByRole('alert');
    expect(audio().pause).toHaveBeenCalled();
  });

  it('reports it as a spoken reply of mode "greeting" once it really starts, and never calls /tts', async () => {
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(track).toHaveBeenCalledWith('concierge_voice_reply_spoken', { mode: 'greeting' });
    expect(vi.mocked(track).mock.calls.filter(([name]) => name === 'concierge_voice_reply_spoken')).toHaveLength(1);
    expect(fetchTts).not.toHaveBeenCalled();
    expect(postChat).not.toHaveBeenCalled();
  });

  it('asks /health once for the whole page load: the bubble at mount, and the panel reuses the answer', async () => {
    await loadPage();
    expect(fetchVoiceCaps).toHaveBeenCalledTimes(1);
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(fetchVoiceCaps).toHaveBeenCalledTimes(1);
  });

  it('shows the speaking state with the equalizer while it plays, and goes back to idle at the end', async () => {
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(equalizer()).toBeInTheDocument();

    act(() => audio().onended?.());
    expect(equalizer()).not.toBeInTheDocument();
    // The speaker toggle is there (the server voice is known) and shows sound on.
    expect(screen.getByRole('button', { name: vc.VOICE_SPEAK_TOGGLE })).toHaveAttribute('aria-pressed', 'true');
  });

  it('stops when the visitor taps the equalizer, and when the speaker is switched off', async () => {
    const user = userEvent.setup();
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();

    await user.click(screen.getByRole('button', { name: vc.VOICE_SPEAK_TOGGLE }));
    expect(audio().pause).toHaveBeenCalled();
    expect(equalizer()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: vc.VOICE_SPEAK_TOGGLE })).toHaveAttribute('aria-pressed', 'false');
    expect(storedPrefs()).toMatchObject({ speak: false, greeted: true });
  });

  it('stops when the chat is closed', async () => {
    const user = userEvent.setup();
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(equalizer()).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(audio().pause).toHaveBeenCalled();
    expect(equalizer()).not.toBeInTheDocument();
  });

  it('counts as the first use of voice: sound on, the microphone line shown, and it is remembered', async () => {
    await loadPage();
    expect(storedPrefs()).toBeNull();
    clickBubble();
    expect(storedPrefs()).toEqual({ speak: true, disclosed: true, greeted: true }); // written inside the click
    await screen.findByRole('dialog');
    await settle();
    expect(screen.getByText(vc.VOICE_DISCLOSURE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: vc.VOICE_SPEAK_TOGGLE })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps a "speak" choice the visitor already made, and a disclosure already shown', async () => {
    setPrefs({ speak: true, disclosed: false });
    await loadPage();
    clickBubble();
    expect(storedPrefs()).toEqual({ speak: true, disclosed: true, greeted: true });
  });

  it('then reads typed replies aloud, through the usual /tts path', async () => {
    const user = userEvent.setup();
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hello{Enter}');
    await settle();
    expect(postChat).toHaveBeenCalledTimes(1);
    expect(fetchTts).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchTts).mock.calls[0][0]).toBe('A reply to read aloud.');
    expect(audio().pause).toHaveBeenCalled(); // typing stopped the greeting before the reply came
  });

  it('is replaced by a reply that arrives while it is still playing (a section button asks a question at once)', async () => {
    let answer!: (result: ChatResult) => void;
    vi.mocked(postChat).mockReturnValue(new Promise<ChatResult>((resolve) => (answer = resolve)));
    await loadPage();
    act(() => openConcierge({ source: 'section_cta', quickReply: 'Try the AI Concierge' }));
    await screen.findByRole('dialog');
    await settle();

    // The question was sent, the answer is awaited, and the greeting is still going: it was not cut off.
    expect(postChat).toHaveBeenCalledTimes(1);
    expect(audio().play).toHaveBeenCalledTimes(1);
    expect(audio().pause).not.toHaveBeenCalled();
    expect(equalizer()).toBeInTheDocument();
    expect(fetchTts).not.toHaveBeenCalled();

    answer(okChat('Here is the answer.'));
    await settle();
    expect(audio().pause).toHaveBeenCalled(); // the reply took over from the greeting
    expect(fetchTts).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchTts).mock.calls[0][0]).toBe('Here is the answer.');
  });
});

describe('a greeting that starts on a later open, when the panel already exists', () => {
  /** /health is slow: the first open finds no answer; the answer then arrives, and the chat is opened again. */
  const firstOpenWithoutAnswer = async () => {
    let answer!: (caps: { tts: 'server' | 'none' }) => void;
    vi.mocked(fetchVoiceCaps).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(FakeAudio.instances).toHaveLength(0);
    await user.keyboard('{Escape}');
    answer({ tts: 'server' });
    await settle();
    return user;
  };

  it('takes it over: sound on, speaking, and the first-use preferences stay saved', async () => {
    const user = await firstOpenWithoutAnswer();
    clickBubble();
    expect(audio().play).toHaveBeenCalledTimes(1);
    await settle();
    expect(equalizer()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: vc.VOICE_SPEAK_TOGGLE })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(vc.VOICE_DISCLOSURE)).toBeInTheDocument();
    expect(storedPrefs()).toEqual({ speak: true, disclosed: true, greeted: true });

    // Later changes made by the controller keep what the click saved.
    await user.click(screen.getByRole('button', { name: vc.VOICE_SPEAK_TOGGLE }));
    await user.click(screen.getByRole('button', { name: vc.VOICE_SPEAK_TOGGLE }));
    expect(storedPrefs()).toEqual({ speak: true, disclosed: true, greeted: true });
  });

  it('and does not lose "greeted" when it has to offer the tap-to-hear pill', async () => {
    const user = await firstOpenWithoutAnswer();
    let plays = 0;
    FakeAudio.playImpl = async () => {
      plays += 1;
      if (plays === 1) throw notAllowed();
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob([new Uint8Array([1])]) })));
    clickBubble();
    await settle();
    expect(await screen.findByRole('button', { name: vc.VOICE_TAP_TO_HEAR })).toBeInTheDocument();
    expect(storedPrefs()).toEqual({ speak: true, disclosed: true, greeted: true, soundHint: true });

    await user.keyboard('{Escape}');
    clickBubble(); // a third open: once is enough
    await settle();
    expect(audio().play).toHaveBeenCalledTimes(1);
  });
});

describe('the greeting does not play', () => {
  const opensQuietly = async () => {
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(FakeAudio.instances).toHaveLength(0);
    expect(equalizer()).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalledWith('concierge_voice_reply_spoken', expect.anything());
  };

  it('when the visitor turned sound off', async () => {
    setPrefs({ speak: false, disclosed: true });
    await loadPage();
    await opensQuietly();
    expect(storedPrefs()).toEqual({ speak: false, disclosed: true }); // nothing was written
  });

  it('when today\'s allowance of spoken replies is used up', async () => {
    setPrefs({ speak: true, disclosed: true, spokenLimit: true, spokenLimitAt: Date.now() });
    await loadPage();
    await opensQuietly();
    expect(storedPrefs().greeted).toBeUndefined();
  });

  it('but does when that allowance was only seen long ago (the cap has lapsed)', async () => {
    setPrefs({ speak: true, disclosed: true, spokenLimit: true, spokenLimitAt: Date.now() - 2 * 60 * 60 * 1000 });
    await loadPage();
    clickBubble();
    expect(audio().play).toHaveBeenCalledTimes(1);
  });

  it('when voice already gave up for this tab', async () => {
    setPrefs({ speak: true, disclosed: true, blocked: true });
    await loadPage();
    await opensQuietly();
  });

  it('when the visitor has already said something', async () => {
    seedThread([message('assistant', copy.GREETING, true), message('user', 'hi'), message('assistant', 'Hello.')]);
    await loadPage();
    await opensQuietly();
    expect(storedPrefs()).toBeNull();
  });

  it('when only a visitor message is stored (no greeting)', async () => {
    seedThread([message('user', 'hi')]);
    await loadPage();
    await opensQuietly();
  });

  it('but does when the stored thread is nothing but the greeting', async () => {
    seedThread([message('assistant', copy.GREETING, true)]);
    await loadPage();
    clickBubble();
    expect(audio().play).toHaveBeenCalledTimes(1);
    await screen.findByRole('dialog');
    await settle();
    expect(screen.getAllByText(copy.GREETING)).toHaveLength(1);
  });

  it('a second time in the same session: closing and reopening does not repeat it', async () => {
    const user = userEvent.setup();
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(audio().play).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    clickBubble();
    await settle();
    clickBubble(); // close
    clickBubble(); // and once more
    await settle();
    expect(FakeAudio.instances).toHaveLength(1);
    expect(audio().play).toHaveBeenCalledTimes(1);
  });

  it('a second time after the page is reloaded in the same tab', async () => {
    const first = await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    first.unmount();

    // A reload: new module state, same sessionStorage.
    resetSpeech();
    resetGreeting();
    FakeAudio.instances = [];
    vi.mocked(track).mockClear();
    await loadPage();
    await opensQuietly();
    expect(storedPrefs()).toMatchObject({ greeted: true });
  });

  it('a second time even if the browser will not remember that it played', async () => {
    const user = userEvent.setup();
    await loadPage();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage is full');
    });
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(audio().play).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    clickBubble();
    await settle();
    expect(audio().play).toHaveBeenCalledTimes(1);
  });

  it('when /health has not answered yet (the chat itself opens as usual)', async () => {
    vi.mocked(fetchVoiceCaps).mockReturnValue(new Promise(() => {}));
    await loadPage();
    await opensQuietly();
    expect(screen.getByText(copy.GREETING)).toBeInTheDocument();
    expect(storedPrefs()).toBeNull();
  });

  it('when /health said there is no server voice', async () => {
    vi.mocked(fetchVoiceCaps).mockResolvedValue({ tts: 'none' });
    await loadPage();
    await opensQuietly();
    expect(storedPrefs()).toBeNull();
  });

  it('when /health failed', async () => {
    vi.mocked(fetchVoiceCaps).mockResolvedValue(null);
    await loadPage();
    await opensQuietly();
  });

  it('when /health threw', async () => {
    vi.mocked(fetchVoiceCaps).mockRejectedValue(new Error('network'));
    await loadPage();
    await opensQuietly();
  });
});

describe('when the browser will not play it without a tap', () => {
  const refuseFirstPlay = () => {
    let plays = 0;
    FakeAudio.playImpl = async () => {
      plays += 1;
      if (plays === 1) throw notAllowed();
    };
    const get = vi.fn(async () => ({ ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])]) }));
    vi.stubGlobal('fetch', get);
    return get;
  };

  it('offers "Tap to hear replies" under the greeting message, and the tap plays it', async () => {
    const fetchFile = refuseFirstPlay();
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();

    expect(fetchFile).toHaveBeenCalledWith(GREETING_URL, expect.anything());
    const pill = await screen.findByRole('button', { name: vc.VOICE_TAP_TO_HEAR });
    expect(pill.closest('li')).toHaveTextContent(copy.GREETING);
    expect(screen.getByText(vc.VOICE_SOUND_OFF_HINT)).toBeInTheDocument();
    expect(equalizer()).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalledWith('concierge_voice_reply_spoken', expect.anything()); // nothing was heard yet

    // The tap: play() is reached synchronously inside it, with the audio that was already fetched.
    fireEvent.click(pill);
    expect(audio().play).toHaveBeenCalledTimes(2);
    expect(audio().src).toBe('blob:fake');
    await settle();
    expect(screen.queryByRole('button', { name: vc.VOICE_TAP_TO_HEAR })).not.toBeInTheDocument();
    expect(screen.queryByText(vc.VOICE_SOUND_OFF_HINT)).not.toBeInTheDocument();
    expect(equalizer()).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith('concierge_voice_reply_spoken', { mode: 'greeting' });
    expect(fetchTts).not.toHaveBeenCalled();
  });

  it('keeps the audio for the panel when the refusal comes before the panel exists', async () => {
    refuseFirstPlay();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    render(
      <ChatBubble
        panelLoader={async () => {
          await gate;
          return import('../ChatPanel');
        }}
      />
    );
    await settle();
    clickBubble();
    await settle(); // refused, fetched, parked: still no panel, so no controller to give it to
    expect(audio().play).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    release();
    const pill = await screen.findByRole('button', { name: vc.VOICE_TAP_TO_HEAR });
    expect(pill.closest('li')).toHaveTextContent(copy.GREETING);
    fireEvent.click(pill);
    expect(audio().play).toHaveBeenCalledTimes(2);
    expect(audio().src).toBe('blob:fake');
  });

  it('does nothing visible when the file cannot be fetched either, or fails to play for another reason', async () => {
    FakeAudio.playImpl = async () => {
      throw new DOMException('no source', 'NotSupportedError');
    };
    const fetchFile = vi.fn();
    vi.stubGlobal('fetch', fetchFile);
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(fetchFile).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: vc.VOICE_TAP_TO_HEAR })).not.toBeInTheDocument();
    expect(screen.queryByText(vc.VOICE_SOUND_OFF_HINT)).not.toBeInTheDocument();
    expect(equalizer()).not.toBeInTheDocument();
    expect(screen.getByText(copy.GREETING)).toBeInTheDocument();
  });

  it('shows no pill if the file is missing from the server', async () => {
    let plays = 0;
    FakeAudio.playImpl = async () => {
      plays += 1;
      if (plays === 1) throw notAllowed();
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, blob: async () => new Blob([]) })));
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(screen.queryByRole('button', { name: vc.VOICE_TAP_TO_HEAR })).not.toBeInTheDocument();
  });

  it('shows no pill if the visitor turned sound off while the file was on its way', async () => {
    const user = userEvent.setup();
    let plays = 0;
    FakeAudio.playImpl = async () => {
      plays += 1;
      if (plays === 1) throw notAllowed();
    };
    let deliver!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => (deliver = resolve))));
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();

    await user.click(screen.getByRole('button', { name: vc.VOICE_SPEAK_TOGGLE })); // sound off
    deliver({ ok: true, blob: async () => new Blob([new Uint8Array([1])]) });
    await settle();
    expect(screen.queryByRole('button', { name: vc.VOICE_TAP_TO_HEAR })).not.toBeInTheDocument();
  });
});
