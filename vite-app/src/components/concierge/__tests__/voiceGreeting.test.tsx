import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatResult } from '../api';

// Everything real (the bubble, the lazy panel, the controller, the speech module, the storage) except the
// network, analytics and the <audio> element, which is a fake that records what was played.
// The page-load /health read is the real one, over a stubbed fetch; the mocked api.fetchVoiceCaps is only
// what the panel's controller falls back on when the page-load answer cannot be reused.
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  postChat: vi.fn(),
  postLead: vi.fn(),
  fetchTts: vi.fn(),
  fetchVoiceCaps: vi.fn(),
}));
vi.mock('../turnstile', () => ({ getToken: vi.fn() }));
vi.mock('../../../lib/track', () => ({ track: vi.fn() }));
vi.mock('../../../hooks/useLenis', () => ({ getLenis: vi.fn() }));

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
  /** The source of every play() so far, in order. */
  static played: string[] = [];
  static playImpl: (audio: FakeAudio) => Promise<void> = async () => {};
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(() => {
    FakeAudio.played.push(this.src);
    return FakeAudio.playImpl(this);
  });
  pause = vi.fn();
  constructor() {
    FakeAudio.instances.push(this);
  }
}

const notAllowed = () => new DOMException('The request is not allowed', 'NotAllowedError');

/** The network, as the page sees it: /health, and the greeting file (fetched only when playback is refused). */
const net = {
  healthCalls: 0,
  fileCalls: 0,
  health: (() => Promise.resolve(null)) as () => Promise<unknown>,
  file: (() => Promise.resolve(null)) as () => Promise<unknown>,
};
const healthOf = (tts: string, extra: Record<string, unknown> = {}) => ({
  status: 200,
  ok: true,
  json: async () => ({ ok: true, voice: { stt: false, tts, configured: true, ...extra } }),
});
const answerOf = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const fileOf = () => ({ ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])]) });

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
const spoken = (name: string) => vi.mocked(track).mock.calls.filter(([event]) => event === name);

beforeEach(() => {
  vi.clearAllMocks();
  resetSpeech();
  resetGreeting();
  window.sessionStorage.clear();
  FakeAudio.instances = [];
  FakeAudio.played = [];
  FakeAudio.playImpl = async () => {};
  net.healthCalls = 0;
  net.fileCalls = 0;
  net.health = () => Promise.resolve(healthOf('server'));
  net.file = () => Promise.resolve(fileOf());
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (String(url).endsWith('/health')) {
        net.healthCalls += 1;
        return net.health();
      }
      net.fileCalls += 1;
      return net.file();
    })
  );
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
  Reflect.deleteProperty(document, 'readyState');
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

  it('is reported as the greeting being played, not as a spoken reply, and never calls /tts', async () => {
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(spoken('concierge_greeting_played')).toEqual([['concierge_greeting_played']]);
    expect(spoken('concierge_voice_reply_spoken')).toHaveLength(0);
    expect(fetchTts).not.toHaveBeenCalled();
    expect(postChat).not.toHaveBeenCalled();
  });

  it('asks /health once for the whole page load: the bubble after load, and the panel reuses the answer', async () => {
    await loadPage();
    expect(net.healthCalls).toBe(1);
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(net.healthCalls).toBe(1);
    expect(fetchVoiceCaps).not.toHaveBeenCalled(); // the panel's own check found an answer to reuse
    expect(screen.getByRole('button', { name: vc.VOICE_SPEAK_TOGGLE })).toBeInTheDocument(); // ...and voice is on
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

  it('stops when the speaker is switched off', async () => {
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

  it('stops when the visitor taps the equalizer', async () => {
    const user = userEvent.setup();
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    await user.click(equalizer()!);
    expect(audio().pause).toHaveBeenCalled();
    expect(equalizer()).not.toBeInTheDocument();
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

  it('counts as the first use of voice: sound on, the read-aloud line shown, and it is remembered', async () => {
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
    // That one is a reply: counted as one, and the greeting event stays at one.
    expect(spoken('concierge_voice_reply_spoken')).toEqual([['concierge_voice_reply_spoken', { mode: 'server' }]]);
    expect(spoken('concierge_greeting_played')).toHaveLength(1);
  });
});

describe('a section button opens the chat with a question already asked', () => {
  const askWhileOpening = () =>
    act(() => openConcierge({ source: 'section_cta', quickReply: 'Try the AI Concierge' }));

  it('is replaced by a reply that arrives while the greeting is still playing, not cut off by the question', async () => {
    let answer!: (result: ChatResult) => void;
    vi.mocked(postChat).mockReturnValue(new Promise<ChatResult>((resolve) => (answer = resolve)));
    await loadPage();
    askWhileOpening();
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
    // The text is shown at once, its audio was fetched, but the greeting is not cut off.
    expect(screen.getByText('Here is the answer.')).toBeInTheDocument();
    expect(fetchTts).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchTts).mock.calls[0][0]).toBe('Here is the answer.');
    expect(audio().pause).not.toHaveBeenCalled();
    expect(FakeAudio.played).toEqual([GREETING_URL]);
  });

  describe('a reply that arrives while the greeting plays waits for it', () => {
    const answerDuringGreeting = async (text = 'Here is the answer.') => {
      let answer!: (result: ChatResult) => void;
      vi.mocked(postChat).mockReturnValueOnce(new Promise<ChatResult>((resolve) => (answer = resolve)));
      await loadPage();
      askWhileOpening();
      await screen.findByRole('dialog');
      await settle();
      answer(okChat(text));
      await settle();
    };

    it('plays after the greeting ends, on the one shared element, with no overlap', async () => {
      await answerDuringGreeting();
      expect(FakeAudio.instances).toHaveLength(1);
      expect(FakeAudio.played).toEqual([GREETING_URL]); // fetched, but not played yet
      expect(equalizer()).toBeInTheDocument(); // still the greeting

      act(() => audio().onended?.());
      await settle();
      expect(FakeAudio.instances).toHaveLength(1);
      expect(FakeAudio.played).toEqual([GREETING_URL, 'blob:fake']); // the reply only after the ended event
      expect(fetchTts).toHaveBeenCalledTimes(1); // one fetch, so one against the cap
      expect(spoken('concierge_greeting_played')).toHaveLength(1);
      expect(spoken('concierge_voice_reply_spoken')).toHaveLength(1);
      expect(equalizer()).toBeInTheDocument();
    });

    it('plays at once when the greeting fails to play', async () => {
      await answerDuringGreeting();
      act(() => audio().onerror?.());
      await settle();
      expect(FakeAudio.played).toEqual([GREETING_URL, 'blob:fake']);
    });

    it('starts as soon as it arrives when the greeting ended first', async () => {
      let tts!: (r: { kind: 'ok'; blob: Blob }) => void;
      vi.mocked(fetchTts).mockReturnValueOnce(new Promise((resolve) => (tts = resolve)));
      await answerDuringGreeting();
      act(() => audio().onended?.());
      await settle();
      expect(FakeAudio.played).toEqual([GREETING_URL]); // nothing to play yet
      tts({ kind: 'ok', blob: new Blob([new Uint8Array([1])]) });
      await settle();
      expect(FakeAudio.played).toEqual([GREETING_URL, 'blob:fake']);
    });

    it('a typed message stops the greeting, drops the queued reply, and the newest reply is the one spoken', async () => {
      const user = userEvent.setup();
      await answerDuringGreeting('Here is the answer.');
      vi.mocked(postChat).mockResolvedValue(okChat('The newest reply.'));
      await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hello{Enter}');
      await settle();
      expect(audio().pause).toHaveBeenCalled(); // the greeting stopped
      expect(fetchTts).toHaveBeenCalledTimes(2);
      expect(vi.mocked(fetchTts).mock.calls[1][0]).toBe('The newest reply.');
      // Only the newest reply was played (the silent clip is the iOS unlock inside the send tap).
      expect(FakeAudio.played.filter((src) => !src.startsWith('data:'))).toEqual([GREETING_URL, 'blob:fake']);
      expect(spoken('concierge_voice_reply_spoken')).toHaveLength(1);
    });

    it('turning sound off during the greeting clears the queue', async () => {
      const user = userEvent.setup();
      await answerDuringGreeting();
      await user.click(screen.getByRole('button', { name: vc.VOICE_SPEAK_TOGGLE }));
      await settle();
      expect(audio().pause).toHaveBeenCalled();
      expect(FakeAudio.played).toEqual([GREETING_URL]);
      expect(spoken('concierge_voice_reply_spoken')).toHaveLength(0);
    });

    it('closing the panel clears the queue', async () => {
      const user = userEvent.setup();
      await answerDuringGreeting();
      await user.keyboard('{Escape}');
      await settle();
      act(() => audio().onended?.());
      await settle();
      expect(FakeAudio.played).toEqual([GREETING_URL]);
      expect(spoken('concierge_voice_reply_spoken')).toHaveLength(0);
    });

    it('a newer reply replaces a queued one: only one is ever waiting', async () => {
      await answerDuringGreeting('First answer.');
      vi.mocked(postChat).mockResolvedValueOnce(okChat('Second answer.'));
      askWhileOpening();
      await settle();
      expect(fetchTts).toHaveBeenCalledTimes(2);
      expect(audio().pause).not.toHaveBeenCalled();
      act(() => audio().onended?.());
      await settle();
      expect(FakeAudio.played).toEqual([GREETING_URL, 'blob:fake']); // one reply, not two
      expect(spoken('concierge_voice_reply_spoken')).toHaveLength(1);
    });
  });

  it('but a reply that is being read is stopped by it, like any new input', async () => {
    const user = userEvent.setup();
    await loadPage();
    clickBubble(); // the greeting
    await screen.findByRole('dialog');
    await settle();
    act(() => audio().onended?.()); // ...which ends

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hello{Enter}');
    await settle();
    expect(fetchTts).toHaveBeenCalledTimes(1); // a reply is being read now
    expect(equalizer()).toBeInTheDocument();
    expect(audio().src).toBe('blob:fake');

    // The next answer will never come, so only the new question itself can stop the reading.
    vi.mocked(postChat).mockReturnValue(new Promise(() => {}));
    audio().pause.mockClear();
    act(() => openConcierge({ source: 'section_cta', quickReply: 'What do you do?' }));
    await settle();
    expect(postChat).toHaveBeenCalledTimes(2);
    expect(audio().pause).toHaveBeenCalled();
    expect(equalizer()).not.toBeInTheDocument();
  });
});

describe('the greeting does not play', () => {
  const opensQuietly = async () => {
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(FakeAudio.instances).toHaveLength(0);
    expect(equalizer()).not.toBeInTheDocument();
    expect(spoken('concierge_greeting_played')).toHaveLength(0);
  };

  it('when the visitor turned sound off', async () => {
    setPrefs({ speak: false, disclosed: true });
    await loadPage();
    await opensQuietly();
    expect(storedPrefs()).toEqual({ speak: false, disclosed: true }); // nothing was written
  });

  it("when today's allowance of spoken replies is used up", async () => {
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

  describe('junk entries in the stored thread are ignored, the way the chat itself ignores them', () => {
    const seedRaw = (messages: unknown[]) =>
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ sessionId: crypto.randomUUID(), messages, leadSubmitted: false, ended: false, utm: {} })
      );

    for (const [label, junk] of [
      ['[{}]', [{}]],
      ['[null]', [null]],
      ['a mix of junk', [null, {}, 'text', 7, { id: 1, role: 'user', content: 'x', at: 'now' }]],
    ] as const) {
      it(`${label} is a fresh thread: the greeting plays, and the chat shows just its own greeting`, async () => {
        seedRaw([...junk]);
        await loadPage();
        clickBubble();
        expect(audio().play).toHaveBeenCalledTimes(1);
        await screen.findByRole('dialog');
        await settle();
        expect(screen.getAllByText(copy.GREETING)).toHaveLength(1);
      });
    }

    it('junk beside the greeting message is still just the greeting', async () => {
      seedRaw([null, message('assistant', copy.GREETING, true), {}]);
      await loadPage();
      clickBubble();
      expect(audio().play).toHaveBeenCalledTimes(1);
    });

    it('junk beside a real visitor message is not a fresh thread', async () => {
      seedRaw([null, {}, message('user', 'hi')]);
      await loadPage();
      await opensQuietly();
    });
  });

  it('but does when the stored thread cannot be read (the chat starts fresh then, too)', async () => {
    window.sessionStorage.setItem(STORAGE_KEY, '{not json');
    await loadPage();
    clickBubble();
    expect(audio().play).toHaveBeenCalledTimes(1);
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
    net.health = () => new Promise(() => {});
    await loadPage();
    await opensQuietly();
    expect(screen.getByText(copy.GREETING)).toBeInTheDocument();
    expect(storedPrefs()).toBeNull();
  });

  it('when /health said there is no server voice', async () => {
    net.health = () => Promise.resolve(healthOf('none'));
    await loadPage();
    await opensQuietly();
    expect(storedPrefs()).toBeNull();
  });

  it('when /health said the server voice is not configured', async () => {
    net.health = () => Promise.resolve(healthOf('server', { configured: false }));
    await loadPage();
    await opensQuietly();
  });

  it('when /health said 404', async () => {
    net.health = () => Promise.resolve(answerOf(404, {}));
    await loadPage();
    await opensQuietly();
  });

  it('when /health could not be reached', async () => {
    net.health = () => Promise.reject(new TypeError('offline'));
    await loadPage();
    await opensQuietly();
  });
});

describe('a Worker that answered "no voice" is not asked again by every click', () => {
  const noVoiceAnswers: Array<[string, () => unknown]> = [
    ['speech to text is off and replies are not read aloud', () => answerOf(200, { ok: true, voice: { stt: false, tts: 'browser' } })],
    ['there is no voice block', () => answerOf(200, { ok: true })],
    ['it says 404', () => answerOf(404, {})],
    ['it says 403', () => answerOf(403, {})],
  ];
  for (const [label, answer] of noVoiceAnswers) {
    it(`when ${label}: one request for the page, however many times the chat is opened; no greeting, no voice controls`, async () => {
      net.health = () => Promise.resolve(answer());
      const user = userEvent.setup();
      await loadPage();
      expect(net.healthCalls).toBe(1);

      for (let open = 0; open < 3; open += 1) {
        clickBubble();
        await screen.findByRole('dialog');
        await settle();
        await user.keyboard('{Escape}');
      }
      expect(net.healthCalls).toBe(1); // nothing retried it
      expect(FakeAudio.instances).toHaveLength(0);
      expect(storedPrefs()).toBeNull();
      // The panel took the same answer instead of asking for itself: no voice controls at all.
      expect(fetchVoiceCaps).not.toHaveBeenCalled();
      clickBubble();
      await screen.findByRole('dialog');
      expect(screen.queryByRole('button', { name: vc.VOICE_SPEAK_TOGGLE })).not.toBeInTheDocument();
    });
  }

  it('but a Worker that could not be reached is asked again, by the next click, and the panel asks for itself', async () => {
    net.health = () => Promise.resolve(answerOf(503, {}));
    await loadPage();
    expect(net.healthCalls).toBe(2); // the request and its one retry
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(net.healthCalls).toBe(4); // the click asked again (a request and its retry)
    expect(fetchVoiceCaps).toHaveBeenCalledTimes(1); // there was no answer to reuse, so the panel asked too
  });
});

describe('voice does not depend on the browser having a microphone', () => {
  /** The browser has no microphone API and no MediaRecorder at all. */
  const noMicBrowser = () => {
    expect(navigator.mediaDevices?.getUserMedia).toBeUndefined();
    vi.stubGlobal('MediaRecorder', undefined);
  };

  it('asks /health, plays the greeting and shows the speaker toggle, with stt off and no getUserMedia', async () => {
    noMicBrowser();
    await loadPage();
    expect(net.healthCalls).toBe(1);

    clickBubble();
    expect(FakeAudio.played).toEqual([GREETING_URL]); // inside the click
    await screen.findByRole('dialog');
    await settle();
    expect(spoken('concierge_greeting_played')).toHaveLength(1);
    expect(storedPrefs()).toEqual({ speak: true, disclosed: true, greeted: true });
    expect(screen.getByRole('button', { name: vc.VOICE_SPEAK_TOGGLE })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(vc.VOICE_DISCLOSURE)).toBeInTheDocument();
  });

  it('reads typed replies aloud through /tts', async () => {
    noMicBrowser();
    const user = userEvent.setup();
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hello{Enter}');
    await settle();
    expect(screen.getByText('A reply to read aloud.')).toBeInTheDocument();
    expect(fetchTts).toHaveBeenCalledTimes(1);
    expect(spoken('concierge_voice_reply_spoken')).toHaveLength(1);
  });

  it('has no microphone control anywhere in the panel', async () => {
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(screen.queryByRole('button', { name: /talk|microphone|record/i })).not.toBeInTheDocument();
  });
});

describe('asking /health', () => {
  const setReadyState = (state: DocumentReadyState) =>
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => state });

  it('waits for the page to finish loading, not the first paint', async () => {
    setReadyState('loading');
    render(<Concierge />);
    await settle();
    expect(net.healthCalls).toBe(0);

    act(() => {
      window.dispatchEvent(new Event('load'));
    });
    await settle();
    expect(net.healthCalls).toBe(1);
  });

  it('then waits for an idle moment, with a timeout, where the browser has requestIdleCallback', async () => {
    let idleTask: (() => void) | undefined;
    const requestIdleCallback = vi.fn((cb: () => void) => {
      idleTask = cb;
      return 3;
    });
    vi.stubGlobal('requestIdleCallback', requestIdleCallback);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const { unmount } = render(<Concierge />);
    await settle();
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 5000 });
    expect(net.healthCalls).toBe(0);

    act(() => idleTask?.());
    await settle();
    expect(net.healthCalls).toBe(1);
    unmount(); // while the stubbed idle-callback globals still exist
    Reflect.deleteProperty(window, 'requestIdleCallback');
    Reflect.deleteProperty(window, 'cancelIdleCallback');
  });

  it('a click that comes before the answer asks for it itself (once), so that a later open can play', async () => {
    let answer!: (value: unknown) => void;
    net.health = () => new Promise((resolve) => (answer = resolve));
    const user = userEvent.setup();
    await loadPage();
    expect(net.healthCalls).toBe(1); // in flight

    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(FakeAudio.instances).toHaveLength(0); // no answer yet: no greeting this time
    expect(net.healthCalls).toBe(1); // nothing was asked twice

    answer(healthOf('server'));
    await settle();
    await user.keyboard('{Escape}');
    clickBubble();
    expect(audio().play).toHaveBeenCalledTimes(1); // the later open plays it
  });

  it('a click after a failed request tries again, and the open after that plays', async () => {
    net.health = () => Promise.reject(new TypeError('offline'));
    const user = userEvent.setup();
    await loadPage();
    expect(net.healthCalls).toBe(2); // the request and its one retry

    net.health = () => Promise.resolve(healthOf('server'));
    clickBubble(); // still no answer: no greeting, but it asks again
    await screen.findByRole('dialog');
    await settle();
    expect(FakeAudio.instances).toHaveLength(0);
    expect(net.healthCalls).toBe(3);

    await user.keyboard('{Escape}');
    clickBubble();
    expect(audio().play).toHaveBeenCalledTimes(1);
    expect(net.healthCalls).toBe(3);
  });
});

describe('a hidden tab', () => {
  const hideTab = () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    return hidden;
  };

  it('stops the greeting even while the panel chunk is still on its way', async () => {
    render(<ChatBubble panelLoader={() => new Promise(() => {})} />);
    await settle();
    clickBubble();
    expect(audio().play).toHaveBeenCalledTimes(1);
    expect(audio().pause).not.toHaveBeenCalled();

    hideTab();
    expect(audio().pause).toHaveBeenCalled();
  });

  it('does not leave the panel, which mounts afterwards, believing it is still speaking', async () => {
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
    hideTab();
    release();
    await screen.findByRole('dialog', { hidden: true });
    await settle();
    expect(equalizer()).not.toBeInTheDocument();
  });

  it('a tab that is not hidden is left alone', async () => {
    render(<ChatBubble panelLoader={() => new Promise(() => {})} />);
    await settle();
    clickBubble();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(audio().pause).not.toHaveBeenCalled();
  });
});

describe('when the browser will not play it without a tap', () => {
  const refuseFirstPlay = () => {
    let plays = 0;
    FakeAudio.playImpl = async () => {
      plays += 1;
      if (plays === 1) throw notAllowed();
    };
  };

  it('offers "Tap to hear replies" under the greeting message, and the tap plays it', async () => {
    refuseFirstPlay();
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();

    expect(net.fileCalls).toBe(1);
    const pill = await screen.findByRole('button', { name: vc.VOICE_TAP_TO_HEAR });
    expect(pill.closest('li')).toHaveTextContent(copy.GREETING);
    expect(screen.getByText(vc.VOICE_SOUND_OFF_HINT)).toBeInTheDocument();
    expect(equalizer()).not.toBeInTheDocument();
    expect(spoken('concierge_greeting_played')).toHaveLength(0); // nothing was heard yet

    // The tap: play() is reached synchronously inside it, with the audio that was already fetched.
    fireEvent.click(pill);
    expect(audio().play).toHaveBeenCalledTimes(2);
    expect(audio().src).toBe('blob:fake');
    await settle();
    expect(screen.queryByRole('button', { name: vc.VOICE_TAP_TO_HEAR })).not.toBeInTheDocument();
    expect(screen.queryByText(vc.VOICE_SOUND_OFF_HINT)).not.toBeInTheDocument();
    expect(equalizer()).toBeInTheDocument();
    // Once it really plays it is the greeting, not a reply.
    expect(spoken('concierge_greeting_played')).toEqual([['concierge_greeting_played']]);
    expect(spoken('concierge_voice_reply_spoken')).toHaveLength(0);
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

  it('does nothing visible when it fails to play for another reason', async () => {
    FakeAudio.playImpl = async () => {
      throw new DOMException('no source', 'NotSupportedError');
    };
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(net.fileCalls).toBe(0);
    expect(screen.queryByRole('button', { name: vc.VOICE_TAP_TO_HEAR })).not.toBeInTheDocument();
    expect(screen.queryByText(vc.VOICE_SOUND_OFF_HINT)).not.toBeInTheDocument();
    expect(equalizer()).not.toBeInTheDocument();
    expect(screen.getByText(copy.GREETING)).toBeInTheDocument();
  });

  it('shows no pill if the file is missing from the server', async () => {
    refuseFirstPlay();
    net.file = () => Promise.resolve({ ok: false, blob: async () => new Blob([]) });
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(screen.queryByRole('button', { name: vc.VOICE_TAP_TO_HEAR })).not.toBeInTheDocument();
  });

  it('shows no pill if the visitor turned sound off while the file was on its way', async () => {
    const user = userEvent.setup();
    refuseFirstPlay();
    let deliver!: (value: unknown) => void;
    net.file = () => new Promise((resolve) => (deliver = resolve));
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();

    await user.click(screen.getByRole('button', { name: vc.VOICE_SPEAK_TOGGLE })); // sound off
    deliver(fileOf());
    await settle();
    expect(screen.queryByRole('button', { name: vc.VOICE_TAP_TO_HEAR })).not.toBeInTheDocument();
  });
});

describe('a greeting that starts on a later open, when the panel already exists', () => {
  /** /health is slow: the first open finds no answer; the answer then arrives, and the chat is opened again. */
  const firstOpenWithoutAnswer = async () => {
    let answer!: (value: unknown) => void;
    net.health = () => new Promise((resolve) => (answer = resolve));
    const user = userEvent.setup();
    await loadPage();
    clickBubble();
    await screen.findByRole('dialog');
    await settle();
    expect(FakeAudio.instances).toHaveLength(0);
    await user.keyboard('{Escape}');
    answer(healthOf('server'));
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
