import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ChatResult } from '../api';

vi.mock('../api', () => ({
  postChat: vi.fn(),
  postLead: vi.fn(),
  fetchTts: vi.fn(),
  fetchVoiceCaps: vi.fn(),
}));
vi.mock('../turnstile', () => ({ getToken: vi.fn() }));
vi.mock('../../../lib/track', () => ({ track: vi.fn() }));
vi.mock('../voice/speech', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../voice/speech')>()),
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
  speakBlob: vi.fn(),
  unlockSpeech: vi.fn(),
}));

import { fetchTts, fetchVoiceCaps, postChat, postLead } from '../api';
import { getToken } from '../turnstile';
import { track } from '../../../lib/track';
import { speak, speakBlob, stopSpeaking, unlockSpeech } from '../voice/speech';
import { useConcierge } from '../useConcierge';
import { EMPTY_LEAD_DRAFT } from '../leadDraft';
import { STORAGE_KEY } from '../storage';
import { VOICE_PREFS_KEY } from '../voice/prefs';
import * as copy from '../copy';
import * as voiceCopy from '../voice/copy';

const postChatMock = vi.mocked(postChat);
const fetchTtsMock = vi.mocked(fetchTts);
const fetchCapsMock = vi.mocked(fetchVoiceCaps);
const getTokenMock = vi.mocked(getToken);
const trackMock = vi.mocked(track);
const speakMock = vi.mocked(speak);
const speakBlobMock = vi.mocked(speakBlob);
const postLeadMock = vi.mocked(postLead);
const stopSpeakingMock = vi.mocked(stopSpeaking);
const unlockMock = vi.mocked(unlockSpeech);

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

type Hook = ReturnType<typeof setup>['result'];
const setup = () => renderHook(() => useConcierge());

/** Let promise chains (several awaits deep) finish. */
const settle = async () => {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const open = async (result: Hook) => {
  await act(async () => {
    await result.current.handleOpen({ source: 'bubble' });
  });
  await settle();
};

/** Open the chat on a browser where voice works. */
const openWithVoice = async (tts: 'server' | 'none' = 'server') => {
  fetchCapsMock.mockResolvedValue({ tts });
  const hook = setup();
  await open(hook.result);
  return hook;
};

const voiceEvents = () =>
  trackMock.mock.calls.filter(([name]) => String(name).startsWith('concierge_voice'));

const storedPrefs = () => JSON.parse(window.sessionStorage.getItem(VOICE_PREFS_KEY) ?? 'null');

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  getTokenMock.mockResolvedValue(null);
  postChatMock.mockResolvedValue(okChat('We help local businesses save time.'));
  fetchCapsMock.mockResolvedValue({ tts: 'server' });
});

// ---- Availability ------------------------------------------------------------

describe('voice availability', () => {
  it('turns on once the Worker has a server voice, with no microphone support involved', async () => {
    const { result } = setup();
    expect(result.current.voice).toBe('off');
    await open(result);
    expect(fetchCapsMock).toHaveBeenCalledTimes(1);
    expect(result.current.voice).toBe('idle');
    expect(result.current.speakAvailable).toBe(true);
    // jsdom has no getUserMedia at all: the controller never asked for one.
    expect(navigator.mediaDevices?.getUserMedia).toBeUndefined();
  });

  it('checks only once, however many times the chat opens', async () => {
    const { result } = await openWithVoice();
    await open(result);
    await open(result);
    expect(fetchCapsMock).toHaveBeenCalledTimes(1);
  });

  it('stays off when the Worker says no or cannot be reached', async () => {
    fetchCapsMock.mockResolvedValue(null);
    const { result } = setup();
    await open(result);
    expect(result.current.voice).toBe('off');
    expect(result.current.speakAvailable).toBe(false);
  });

  it('has no recording state or action left', async () => {
    const { result } = await openWithVoice();
    for (const key of ['startVoice', 'stopVoice', 'cancelVoice', 'cancelRecording', 'subscribeLevel', 'voiceEnding']) {
      expect(key in result.current, key).toBe(false);
    }
  });
});

describe('voice: reading replies aloud', () => {
  it('is on by default when there is a server voice, and the first typed send unlocks speech in the tap', async () => {
    const { result } = await openWithVoice();
    expect(result.current.speakEnabled).toBe(true);
    expect(result.current.speakAvailable).toBe(true);
    expect(result.current.voiceDisclosed).toBe(false);
    expect(window.sessionStorage.getItem(VOICE_PREFS_KEY)).toBeNull();

    unlockMock.mockClear();
    await act(async () => {
      await result.current.send('hello');
    });
    expect(unlockMock).toHaveBeenCalledTimes(1); // inside the send, before the reply: no greeting played
    expect(speakMock).toHaveBeenCalledTimes(1); // and the reply is read
  });

  it('an explicit "sound off" is respected: not on by default, nothing unlocked or spoken, and it is remembered', async () => {
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: false, disclosed: true }));
    const { result } = await openWithVoice();
    expect(result.current.speakEnabled).toBe(false);
    unlockMock.mockClear();
    await act(async () => {
      await result.current.send('hello');
    });
    expect(unlockMock).not.toHaveBeenCalled();
    expect(speakMock).not.toHaveBeenCalled();

    act(() => result.current.setSpeakEnabled(true));
    const again = await openWithVoice();
    expect(again.result.current.speakEnabled).toBe(true);
  });

  it('the default does nothing without a server voice: no unlock, no audio request', async () => {
    const { result } = await openWithVoice('none');
    expect(result.current.speakAvailable).toBe(false);
    unlockMock.mockClear();
    await act(async () => {
      await result.current.send('hello');
    });
    expect(unlockMock).not.toHaveBeenCalled();
    expect(fetchTtsMock).not.toHaveBeenCalled();
  });

  it('the read-aloud line goes when the panel closes (stopAll)', async () => {
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: true, disclosed: true }));
    const { result } = await openWithVoice();
    expect(result.current.voiceDisclosed).toBe(false); // already shown in an earlier visit this tab
    await act(async () => {
      result.current.stopAll();
    });
    expect(result.current.voiceDisclosed).toBe(false);
  });

  it('the toggle persists, unlocks speech when switched on, and stops speech when switched off', async () => {
    const { result } = await openWithVoice();
    unlockMock.mockClear();
    act(() => result.current.setSpeakEnabled(true));
    expect(result.current.speakEnabled).toBe(true);
    expect(unlockMock).toHaveBeenCalledTimes(1);
    expect(storedPrefs()).toEqual({ speak: true, disclosed: false });

    stopSpeakingMock.mockClear();
    act(() => result.current.setSpeakEnabled(false));
    expect(result.current.speakEnabled).toBe(false);
    expect(stopSpeakingMock).toHaveBeenCalled();
    expect(storedPrefs()).toEqual({ speak: false, disclosed: false });

    const again = await openWithVoice();
    expect(again.result.current.speakEnabled).toBe(false);
  });

  it('works with storage disabled', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      const { result } = await openWithVoice();
      act(() => result.current.setSpeakEnabled(true));
      expect(result.current.speakEnabled).toBe(true);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it('speaks each new assistant reply when on, and reports start and end', async () => {
    const { result } = await openWithVoice();
    act(() => result.current.setSpeakEnabled(true));
    await act(async () => {
      await result.current.send('What do you do?');
    });

    expect(speakMock).toHaveBeenCalledTimes(1);
    const [text, hooks] = speakMock.mock.calls[0];
    expect(text).toBe('We help local businesses save time.');

    act(() => hooks!.onStart?.('server'));
    expect(result.current.voice).toBe('speaking');
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_reply_spoken', { mode: 'server' });

    act(() => hooks!.onEnd?.());
    expect(result.current.voice).toBe('idle');
  });

  it('also speaks the local hand-off answer', async () => {
    const { result } = await openWithVoice();
    act(() => result.current.setSpeakEnabled(true));
    await act(async () => {
      await result.current.send('Can I talk to a person?');
    });
    expect(postChatMock).not.toHaveBeenCalled();
    expect(speakMock).toHaveBeenCalledWith(copy.HANDOFF, expect.anything());
  });

  it('does not speak when reading aloud is off, or the server voice is off for this visit, or voice is off altogether', async () => {
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: false, disclosed: true }));
    const { result } = await openWithVoice();
    await act(async () => {
      await result.current.send('hello');
    });
    expect(speakMock).not.toHaveBeenCalled(); // reading aloud is off

    // The Worker has no server voice (or says it is not configured): text only, toggle or no toggle.
    const none = await openWithVoice('none');
    act(() => none.result.current.setSpeakEnabled(true));
    await act(async () => {
      await none.result.current.send('hello again');
    });
    expect(speakMock).not.toHaveBeenCalled();
    expect(fetchTtsMock).not.toHaveBeenCalled();

    // Voice off for the whole session (the Worker has none): nothing is read either, even if it was on.
    fetchCapsMock.mockResolvedValue(null);
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: true, disclosed: true }));
    const off = setup();
    await open(off.result);
    expect(off.result.current.voice).toBe('off');
    await act(async () => {
      await off.result.current.send('hello');
    });
    expect(speakMock).not.toHaveBeenCalled();
  });

  it('any new input stops the reading: send, chip, or stopSpeaking()', async () => {
    const { result } = await openWithVoice();
    stopSpeakingMock.mockClear();
    await act(async () => {
      await result.current.send('hello');
    });
    expect(stopSpeakingMock).toHaveBeenCalledTimes(1);

    stopSpeakingMock.mockClear();
    await act(async () => {
      await result.current.chip('Request a callback'); // opens the form, sends nothing
    });
    expect(stopSpeakingMock).toHaveBeenCalled();

    stopSpeakingMock.mockClear();
    act(() => result.current.stopSpeaking());
    expect(stopSpeakingMock).toHaveBeenCalledTimes(1);
  });

  it('a message that is ignored (a reply is pending) does not interrupt the reading', async () => {
    const { result } = await openWithVoice();
    postChatMock.mockReturnValue(new Promise(() => {}));
    act(() => {
      void result.current.send('first');
    });
    stopSpeakingMock.mockClear();
    await act(async () => {
      await result.current.send('second, while waiting');
    });
    expect(stopSpeakingMock).not.toHaveBeenCalled();
  });

  it('uses the server voice when /health says so, fetching the audio with the session id and passing every answer on', async () => {
    const { result } = await openWithVoice('server');
    act(() => result.current.setSpeakEnabled(true));
    expect(unlockMock).toHaveBeenCalled();
    await act(async () => {
      await result.current.send('hello');
    });
    const [text, hooks] = speakMock.mock.calls[0];

    const blob = new Blob([new Uint8Array(3)], { type: 'audio/mpeg' });
    const signal = new AbortController().signal;
    for (const answer of [
      { kind: 'ok', blob },
      { kind: 'limit', bonusAvailable: true },
      { kind: 'unavailable' },
    ] as const) {
      fetchTtsMock.mockResolvedValueOnce(answer);
      expect(await hooks!.fetchAudio!(text, signal)).toEqual(answer);
    }
    // The run's abort signal goes with the request.
    expect(fetchTtsMock).toHaveBeenCalledWith(text, result.current.sessionId, signal);
  });
});

// ---- Privacy -----------------------------------------------------------------

describe('voice: analytics hygiene', () => {
  it('never puts audio or message text in a tracked parameter', async () => {
    postChatMock.mockResolvedValue(okChat('We saved your number 770 555 0147.'));
    const { result } = await openWithVoice();
    act(() => result.current.setSpeakEnabled(true));
    await act(async () => {
      await result.current.send('my number is 770 555 0147');
    });
    act(() => speakMock.mock.calls[0][1]!.onStart?.('server'));

    const events = voiceEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const [name, params] of events) {
      for (const [key, value] of Object.entries(params ?? {})) {
        expect(['mode', 'reason'], `${String(name)}.${key}`).toContain(key);
        expect(String(value)).not.toMatch(/770|number|saved/i);
      }
    }
    expect(JSON.stringify(trackMock.mock.calls)).not.toContain('770');
  });

  it('keeps flags only in the voice preferences', async () => {
    const { result } = await openWithVoice();
    act(() => result.current.setSpeakEnabled(true));
    await act(async () => {
      await result.current.send('private words');
    });
    expect(window.sessionStorage.getItem(VOICE_PREFS_KEY)).not.toContain('private');
    expect(Object.keys(storedPrefs()).sort()).toEqual(['disclosed', 'speak']);
    // The chat history (the visitor's own message) is stored as before.
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toContain('private words');
  });
});

describe('voice: replies are read only while the panel is open and the tab visible', () => {
  it('a reply that lands while inactive is shown but not spoken; the next one is spoken once active again', async () => {
    const { result } = await openWithVoice();
    act(() => result.current.setSpeakEnabled(true));
    let resolveChat!: (r: ChatResult) => void;
    postChatMock.mockReturnValueOnce(
      new Promise((r) => {
        resolveChat = r;
      })
    );
    act(() => {
      void result.current.send('first question');
    });
    act(() => result.current.setActive(false)); // the panel was closed, or the tab hidden
    resolveChat(okChat('A reply nobody is looking at.'));
    await settle();
    expect(result.current.messages.at(-1)?.content).toBe('A reply nobody is looking at.');
    expect(speakMock).not.toHaveBeenCalled();

    act(() => result.current.setActive(true));
    postChatMock.mockResolvedValueOnce(okChat('A reply someone is reading.'));
    await act(async () => {
      await result.current.send('second question');
    });
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock.mock.calls[0][0]).toBe('A reply someone is reading.');
  });

  it('is active until told otherwise', async () => {
    const { result } = await openWithVoice();
    act(() => result.current.setSpeakEnabled(true));
    await act(async () => {
      await result.current.send('hello');
    });
    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it('a reply whose audio arrives after the panel was closed or the tab hidden is dropped, not played', async () => {
    const { result } = await openWithVoice();
    act(() => result.current.setSpeakEnabled(true));
    await act(async () => {
      await result.current.send('hello');
    });
    const hooks = speakMock.mock.calls.at(-1)![1]!;
    expect(hooks.canPlay?.()).toBe(true);
    act(() => result.current.setActive(false)); // hidden while the request was out
    expect(hooks.canPlay?.()).toBe(false);
    act(() => result.current.setActive(true));
    expect(hooks.canPlay?.()).toBe(true);
  });

  it('closing the panel stops a reply that is being read', async () => {
    const { result } = await openWithVoice();
    act(() => result.current.setSpeakEnabled(true));
    await act(async () => {
      await result.current.send('hello');
    });
    act(() => speakMock.mock.calls[0][1]!.onStart?.('server'));
    expect(result.current.voice).toBe('speaking');
    stopSpeakingMock.mockClear();
    act(() => {
      result.current.setActive(false);
      result.current.stopAll();
    });
    expect(stopSpeakingMock).toHaveBeenCalled();
    expect(result.current.voice).toBe('idle');
  });
});

// ---- What can read replies aloud ---------------------------------------------

describe('voice: whether the speaker toggle has anything to do', () => {
  it('is available when the Worker has a server voice', async () => {
    const { result } = await openWithVoice('server');
    expect(result.current.speakAvailable).toBe(true);
  });

  it('is not when there is no server voice (there is no browser voice to fall back on)', async () => {
    const { result } = await openWithVoice('none');
    expect(result.current.voice).toBe('idle'); // the mic is still there
    expect(result.current.speakAvailable).toBe(false);
  });

  it('is false while voice is off altogether', async () => {
    fetchCapsMock.mockResolvedValue(null);
    const { result } = setup();
    await open(result);
    expect(result.current.voice).toBe('off');
    expect(result.current.speakAvailable).toBe(false);
  });
});

// ---- Analytics ---------------------------------------------------------------

describe('voice: analytics event names', () => {
  it('uses only the spoken-reply events: reply_spoken, and the budget error (nothing for recording)', async () => {
    const { result } = await openWithVoice();
    act(() => result.current.setSpeakEnabled(true));
    await act(async () => {
      await result.current.send('hello');
    });
    const hooks = speakMock.mock.calls[0][1]!;
    act(() => hooks.onStart?.('server'));
    act(() => hooks.onLimit?.(false));

    const names = new Set(voiceEvents().map(([name]) => String(name)));
    expect([...names].sort()).toEqual(['concierge_voice_error', 'concierge_voice_reply_spoken']);
    const reasons = voiceEvents()
      .filter(([n]) => n === 'concierge_voice_error')
      .map(([, params]) => (params as { reason: string }).reason);
    expect(reasons).toEqual(['budget']);
  });
});

// ---- Text only: no audio of any kind -----------------------------------------

describe('voice: no server voice (text only)', () => {
  it('means text only: no toggle, nothing spoken, nothing unlocked, and typing works', async () => {
    const { result } = await openWithVoice('none');
    expect(result.current.voice).toBe('idle');
    expect(result.current.speakAvailable).toBe(false);

    unlockMock.mockClear();
    await act(async () => {
      await result.current.send('a typed question');
    });
    await settle();
    expect(postChatMock).toHaveBeenCalledTimes(1);
    expect(unlockMock).not.toHaveBeenCalled();

    act(() => result.current.setSpeakEnabled(true));
    await act(async () => {
      await result.current.send('another question');
    });
    expect(speakMock).not.toHaveBeenCalled();
    expect(fetchTtsMock).not.toHaveBeenCalled();
  });
});

// ---- The daily cap on spoken replies -----------------------------------------

describe('voice: the cap on spoken replies', () => {
  const sendAndGetHooks = async (result: Hook, text = 'hello') => {
    speakMock.mockClear();
    await act(async () => {
      await result.current.send(text);
    });
    return speakMock.mock.calls.at(-1)![1]!;
  };

  const serverWithSpeech = async () => {
    const hook = await openWithVoice('server');
    act(() => hook.result.current.setSpeakEnabled(true));
    return hook;
  };

  describe('no bonus on offer', () => {
    it('shows the "done for today" notice, hides the toggle, stops asking for audio, and says so to analytics once', async () => {
      const { result } = await serverWithSpeech();
      expect(result.current.speakAvailable).toBe(true);
      const hooks = await sendAndGetHooks(result);

      act(() => hooks.onLimit?.(false));
      expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_SPOKEN_LIMIT_DONE);
      expect(voiceCopy.VOICE_SPOKEN_LIMIT_DONE).toBe(
        'Read-aloud is done for today. You can keep chatting here.'
      );
      expect(result.current.speakAvailable).toBe(false);
      expect(result.current.readAloudBonus).toBe(false);
      expect(trackMock.mock.calls.filter(([n, p]) => n === 'concierge_voice_error' && (p as { reason: string }).reason === 'budget')).toHaveLength(1);

      // A second report of the same cap (an in-flight reply) is not a second event or notice.
      act(() => result.current.clearComposerError());
      act(() => hooks.onLimit?.(false));
      expect(result.current.voiceNotice).toBeNull();
      expect(trackMock.mock.calls.filter(([n]) => n === 'concierge_voice_error')).toHaveLength(1);

      // From now on replies are text only: nothing is spoken, nothing is requested.
      speakMock.mockClear();
      postChatMock.mockResolvedValueOnce(okChat('Another reply.'));
      await act(async () => {
        await result.current.send('and another');
      });
      expect(speakMock).not.toHaveBeenCalled();
      expect(fetchTtsMock).not.toHaveBeenCalled();
    });

    it('is remembered for the tab: the stored flag, no toggle after a reload, no second notice, and still no audio', async () => {
      const { result } = await serverWithSpeech();
      const hooks = await sendAndGetHooks(result);
      act(() => hooks.onLimit?.(false));
      expect(storedPrefs()).toMatchObject({ spokenLimit: true });
      expect(storedPrefs()?.bonusOffer).toBeUndefined();

      speakMock.mockClear();
      const again = await openWithVoice('server');
      expect(again.result.current.voice).toBe('idle');
      expect(again.result.current.speakAvailable).toBe(false);
      expect(again.result.current.voiceNotice).toBeNull();
      expect(again.result.current.readAloudBonus).toBe(false);
      await act(async () => {
        await again.result.current.send('hello again');
      });
      expect(speakMock).not.toHaveBeenCalled();
    });

    it('is not offered a bonus even if the Worker says so, once details have been shared', async () => {
      window.sessionStorage.setItem(
        VOICE_PREFS_KEY,
        JSON.stringify({ speak: true, disclosed: true, bonusUsed: true })
      );
      const { result } = await openWithVoice('server');
      const hooks = await sendAndGetHooks(result);
      act(() => hooks.onLimit?.(true));
      expect(result.current.readAloudBonus).toBe(false);
      expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_SPOKEN_LIMIT_DONE);
    });

    it('is not offered a bonus once a lead has been sent (there is nothing more to share)', async () => {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sessionId: '11111111-1111-4111-8111-111111111111',
          messages: [],
          leadSubmitted: true,
          ended: false,
          utm: {},
        })
      );
      window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: true, disclosed: true }));
      const { result } = await openWithVoice('server');
      const hooks = await sendAndGetHooks(result);
      act(() => hooks.onLimit?.(true));
      expect(result.current.readAloudBonus).toBe(false);
      expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_SPOKEN_LIMIT_DONE);
    });
  });

  describe('a bonus on offer', () => {
    it('keeps the paused notice (with its chip) up instead of the transient one, and remembers the offer', async () => {
      const { result } = await serverWithSpeech();
      const hooks = await sendAndGetHooks(result);
      act(() => hooks.onLimit?.(true));
      expect(result.current.readAloudBonus).toBe(true);
      expect(result.current.voiceNotice).toBeNull();
      expect(result.current.speakAvailable).toBe(false);
      expect(result.current.bonusCount).toBe(5); // the Worker did not say: the default
      expect(voiceCopy.VOICE_SHARE_DETAILS).toBe('Share my details');
      expect(storedPrefs()).toMatchObject({ spokenLimit: true, bonusOffer: true });
      expect(trackMock).toHaveBeenCalledWith('concierge_voice_error', { reason: 'budget' });

      // Typing does not make the offer go away.
      act(() => result.current.clearComposerError());
      expect(result.current.readAloudBonus).toBe(true);

      // Nor does a reload in the same tab.
      const again = await openWithVoice('server');
      expect(again.result.current.readAloudBonus).toBe(true);
      expect(again.result.current.speakAvailable).toBe(false);
    });

    it('uses the number of bonus replies the Worker names, remembers it, and says it in the form', async () => {
      const { result } = await serverWithSpeech();
      const hooks = await sendAndGetHooks(result);
      act(() => hooks.onLimit?.(true, 10));
      expect(result.current.readAloudBonus).toBe(true);
      expect(result.current.bonusCount).toBe(10);
      expect(storedPrefs()).toMatchObject({ bonusOffer: true, bonusCount: 10 });

      const again = await openWithVoice('server');
      expect(again.result.current.readAloudBonus).toBe(true);
      expect(again.result.current.bonusCount).toBe(10);

      act(() => again.result.current.shareDetails());
      expect(again.result.current.leadHeading).toBe(voiceCopy.voiceBonusFormHeading(10));
    });

    it('resumes spoken replies after a lead with an email is sent, clearing the cap and the notice', async () => {
      postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
      const { result } = await serverWithSpeech();
      const hooks = await sendAndGetHooks(result);
      act(() => hooks.onLimit?.(true));

      await act(async () => {
        await result.current.submitLead({
          name: 'Jane Doe',
          phone: '7705551234',
          email: 'jane@doe.example',
          business: 'Doe Plumbing',
          callbackWindow: 'midday_11_1',
          consent: true,
        });
      });
      expect(result.current.readAloudBonus).toBe(false);
      expect(result.current.speakAvailable).toBe(true);
      expect(storedPrefs()?.spokenLimit).toBeUndefined();
      expect(storedPrefs()).toMatchObject({ bonusUsed: true });

      // The next reply is requested and spoken again.
      speakMock.mockClear();
      postChatMock.mockResolvedValueOnce(okChat('Spoken again.'));
      await act(async () => {
        await result.current.send('more please');
      });
      expect(speakMock).toHaveBeenCalledTimes(1);
      expect(speakMock.mock.calls[0][0]).toBe('Spoken again.');
          });

    it('a lead without an email does not lift the cap, but it does close the offer: no chip that would do nothing', async () => {
      postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
      const { result } = await serverWithSpeech();
      const hooks = await sendAndGetHooks(result);
      act(() => hooks.onLimit?.(true));
      expect(result.current.readAloudBonus).toBe(true);
      await act(async () => {
        await result.current.submitLead({
          name: 'Jane Doe',
          phone: '7705551234',
          business: 'Doe Plumbing',
          callbackWindow: 'midday_11_1',
          consent: true,
        });
      });
      expect(result.current.leadDone).toBe(true);
      expect(result.current.readAloudBonus).toBe(false);
      expect(result.current.speakAvailable).toBe(false);
      // Still capped, no longer on offer: stored that way, so a reload does not bring the chip back.
      expect(storedPrefs()).toMatchObject({ spokenLimit: true });
      expect(storedPrefs()?.bonusOffer).toBeUndefined();
      expect(storedPrefs()?.bonusUsed).toBeUndefined();
      speakMock.mockClear();
      const again = await openWithVoice('server');
      expect(again.result.current.readAloudBonus).toBe(false);
      expect(again.result.current.speakAvailable).toBe(false);
      await act(async () => {
        await again.result.current.send('still capped');
      });
      expect(speakMock).not.toHaveBeenCalled();
    });

    it('never offers the bonus after a lead was sent, even if the stored offer says otherwise (reload)', async () => {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sessionId: '11111111-1111-4111-8111-111111111111',
          messages: [],
          leadSubmitted: true,
          ended: false,
          utm: {},
        })
      );
      window.sessionStorage.setItem(
        VOICE_PREFS_KEY,
        JSON.stringify({ speak: true, disclosed: true, spokenLimit: true, bonusOffer: true })
      );
      const { result } = await openWithVoice('server');
      expect(result.current.leadDone).toBe(true);
      expect(result.current.readAloudBonus).toBe(false);
    });

    it('does not show the offer when the server voice is off, whatever was stored', async () => {
      window.sessionStorage.setItem(
        VOICE_PREFS_KEY,
        JSON.stringify({ speak: true, disclosed: true, spokenLimit: true, bonusOffer: true })
      );
      const { result } = await openWithVoice('none');
      expect(result.current.readAloudBonus).toBe(false);
    });

    it('a failed lead does not lift the cap either', async () => {
      postLeadMock.mockResolvedValue({ kind: 'delivery_failed' });
      const { result } = await serverWithSpeech();
      const hooks = await sendAndGetHooks(result);
      act(() => hooks.onLimit?.(true));
      await act(async () => {
        await result.current.submitLead({
          name: 'Jane Doe',
          phone: '7705551234',
          email: 'jane@doe.example',
          business: 'Doe Plumbing',
          callbackWindow: 'midday_11_1',
          consent: true,
        });
      });
      expect(result.current.readAloudBonus).toBe(true);
      expect(result.current.speakAvailable).toBe(false);
    });

    it('after the bonus is used up too, the cap is final: the "done" notice and no second offer', async () => {
      postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
      const { result } = await serverWithSpeech();
      let hooks = await sendAndGetHooks(result);
      act(() => hooks.onLimit?.(true));
      await act(async () => {
        await result.current.submitLead({
          name: 'Jane Doe',
          phone: '7705551234',
          email: 'jane@doe.example',
          business: 'Doe Plumbing',
          callbackWindow: 'midday_11_1',
          consent: true,
        });
      });
      postChatMock.mockResolvedValueOnce(okChat('Spoken again.'));
      hooks = await sendAndGetHooks(result, 'one more');
      act(() => hooks.onLimit?.(true)); // the Worker, asked again, says the day's replies are gone
      expect(result.current.readAloudBonus).toBe(false);
      expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_SPOKEN_LIMIT_DONE);
      expect(result.current.speakAvailable).toBe(false);
    });
  });
});

// ---- The persisted cap lapses ------------------------------------------------

describe('voice: a remembered cap does not last forever', () => {
  const NOON = new Date('2026-11-04T12:00:00').getTime();
  const storeCap = (at: number | null, extra: Record<string, unknown> = {}) =>
    window.sessionStorage.setItem(
      VOICE_PREFS_KEY,
      JSON.stringify({ speak: true, disclosed: true, spokenLimit: true, spokenLimitAt: at, ...extra })
    );
  const clockAt = (ms: number) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ms);
  };
  afterEach(() => {
    vi.useRealTimers();
  });

  it('records when the cap was seen', async () => {
    clockAt(NOON);
    const { result } = await openWithVoice('server');
    act(() => result.current.setSpeakEnabled(true));
    await act(async () => {
      await result.current.send('hello');
    });
    act(() => speakMock.mock.calls.at(-1)![1]!.onLimit?.(false));
    expect(storedPrefs()).toMatchObject({ spokenLimit: true, spokenLimitAt: NOON });
  });

  it('while it is fresh, nothing is requested for any reply', async () => {
    clockAt(NOON + 30 * 60_000);
    storeCap(NOON);
    const { result } = await openWithVoice('server');
    expect(result.current.speakAvailable).toBe(false);
    for (const text of ['one', 'two', 'three']) {
      postChatMock.mockResolvedValueOnce(okChat(`reply to ${text}`));
      await act(async () => {
        await result.current.send(text);
      });
    }
    expect(speakMock).not.toHaveBeenCalled();
    expect(fetchTtsMock).not.toHaveBeenCalled();
  });

  it('after an hour it lapses on load: the toggle is back and the next reply is requested', async () => {
    clockAt(NOON + 61 * 60_000);
    storeCap(NOON, { bonusOffer: true });
    const { result } = await openWithVoice('server');
    expect(result.current.speakAvailable).toBe(true);
    expect(result.current.readAloudBonus).toBe(false);
    await act(async () => {
      await result.current.send('hello');
    });
    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it('the next day it lapses on load, however recent the cap was', async () => {
    clockAt(new Date('2026-11-05T00:02:00').getTime());
    storeCap(new Date('2026-11-04T23:58:00').getTime());
    const { result } = await openWithVoice('server');
    expect(result.current.speakAvailable).toBe(true);
    await act(async () => {
      await result.current.send('hello');
    });
    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it('a cap written before there was a timestamp lapses too', async () => {
    clockAt(NOON);
    storeCap(null);
    const { result } = await openWithVoice('server');
    expect(result.current.speakAvailable).toBe(true);
  });

  it('lapses in a panel that was left open past the hour, not only on a reload', async () => {
    clockAt(NOON);
    const { result } = await openWithVoice('server');
    act(() => result.current.setSpeakEnabled(true));
    await act(async () => {
      await result.current.send('hello');
    });
    act(() => speakMock.mock.calls.at(-1)![1]!.onLimit?.(false));
    expect(result.current.speakAvailable).toBe(false);

    speakMock.mockClear();
    clockAt(NOON + 30 * 60_000);
    postChatMock.mockResolvedValueOnce(okChat('still capped'));
    await act(async () => {
      await result.current.send('a bit later');
    });
    expect(speakMock).not.toHaveBeenCalled(); // fresh: not asked again on every reply

    clockAt(NOON + 61 * 60_000);
    postChatMock.mockResolvedValueOnce(okChat('an hour on'));
    await act(async () => {
      await result.current.send('much later');
    });
    expect(speakMock).toHaveBeenCalledTimes(1); // the cap lapsed: asked again
    expect(result.current.speakAvailable).toBe(true);
    expect(storedPrefs()?.spokenLimit).toBeUndefined();
  });
});

// ---- Opening the lead form for the bonus -------------------------------------

describe('voice: sharing details for the bonus', () => {
  it('opens the lead form pre-filled, asking for the email, without adding messages to the chat', async () => {
    const { result } = await openWithVoice('server');
    await act(async () => {
      await result.current.send('hello');
    });
    const before = result.current.messages.length;
    act(() => result.current.shareDetails());
    expect(result.current.showLeadForm).toBe(true);
    expect(result.current.leadEmailRequired).toBe(true);
    expect(result.current.leadHeading).toBe(voiceCopy.voiceBonusFormHeading(5));
    expect(result.current.messages).toHaveLength(before);
    expect(trackMock).toHaveBeenCalledWith('concierge_lead_form_shown');
  });

  it('the email is no longer required once the form is dismissed or sent, or when the callback chip opens it', async () => {
    postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
    const { result } = await openWithVoice('server');
    act(() => result.current.shareDetails());
    act(() => result.current.dismissLeadForm());
    expect(result.current.showLeadForm).toBe(false);
    expect(result.current.leadEmailRequired).toBe(false);

    await act(async () => {
      await result.current.chip('Request a callback');
    });
    expect(result.current.showLeadForm).toBe(true);
    expect(result.current.leadEmailRequired).toBe(false);
  });

  it('clears the requirement when the lead is sent', async () => {
    postLeadMock.mockResolvedValue({ kind: 'ok', delivery: 'email' });
    const { result } = await openWithVoice('server');
    act(() => result.current.shareDetails());
    await act(async () => {
      await result.current.submitLead({
        name: 'Jane Doe',
        phone: '7705551234',
        email: 'jane@doe.example',
        business: 'Doe Plumbing',
        callbackWindow: 'midday_11_1',
        consent: true,
      });
    });
    expect(result.current.leadEmailRequired).toBe(false);
    expect(result.current.showLeadForm).toBe(false);
  });

  it('does nothing when the form is already open', async () => {
    const { result } = await openWithVoice('server');
    act(() => result.current.shareDetails());
    trackMock.mockClear();
    act(() => result.current.shareDetails());
    expect(trackMock).not.toHaveBeenCalledWith('concierge_lead_form_shown');
  });
});

// ---- Playback the browser blocks ---------------------------------------------

describe('voice: audio the browser will not start without a tap', () => {
  const blob = () => new Blob([new Uint8Array(3)], { type: 'audio/mpeg' });

  const blockedReply = async (result: Hook, text = 'hello') => {
    speakMock.mockClear();
    await act(async () => {
      await result.current.send(text);
    });
    const hooks = speakMock.mock.calls.at(-1)![1]!;
    const replyId = result.current.messages.at(-1)!.id;
    const audio = blob();
    act(() => hooks.onBlocked?.(audio));
    return { hooks, replyId, audio };
  };

  const serverWithSpeech = async () => {
    const hook = await openWithVoice('server');
    act(() => hook.result.current.setSpeakEnabled(true));
    return hook;
  };

  it('marks that reply as waiting for a tap, with one "Sound is off until you tap." line, the first time only', async () => {
    const { result } = await serverWithSpeech();
    const first = await blockedReply(result);
    expect(result.current.blockedReplyId).toBe(first.replyId);
    expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_SOUND_OFF_HINT);
    expect(voiceCopy.VOICE_SOUND_OFF_HINT).toBe('Sound is off until you tap.');
    expect(storedPrefs()).toMatchObject({ soundHint: true });

    act(() => result.current.clearComposerError());
    postChatMock.mockResolvedValueOnce(okChat('A second reply.'));
    const second = await blockedReply(result, 'again');
    expect(result.current.blockedReplyId).toBe(second.replyId);
    expect(result.current.voiceNotice).toBeNull(); // not shown a second time
  });

  it('keeps the pill on the latest reply only: a new reply that is also blocked moves it, one that plays removes it', async () => {
    const { result } = await serverWithSpeech();
    const first = await blockedReply(result);
    expect(result.current.blockedReplyId).toBe(first.replyId);

    postChatMock.mockResolvedValueOnce(okChat('Second.'));
    await act(async () => {
      await result.current.send('typed instead of tapping');
    });
    // The new reply is being fetched: the old pill no longer stands for the latest reply.
    expect(result.current.blockedReplyId).toBeNull();
    const hooks = speakMock.mock.calls.at(-1)![1]!;
    const secondId = result.current.messages.at(-1)!.id;
    act(() => hooks.onBlocked?.(blob()));
    expect(result.current.blockedReplyId).toBe(secondId);

    postChatMock.mockResolvedValueOnce(okChat('Third.'));
    await act(async () => {
      await result.current.send('and again');
    });
    act(() => speakMock.mock.calls.at(-1)![1]!.onStart?.('server'));
    expect(result.current.blockedReplyId).toBeNull();
  });

  it('playBlocked plays that reply inside the tap, then the pill goes and later replies are not held back', async () => {
    const { result } = await serverWithSpeech();
    const { audio, replyId } = await blockedReply(result);

    act(() => result.current.playBlocked());
    expect(speakBlobMock).toHaveBeenCalledTimes(1);
    expect(speakBlobMock.mock.calls[0][0]).toBe(audio); // the audio already fetched: no second request
    expect(fetchTtsMock).not.toHaveBeenCalled();
    expect(result.current.blockedReplyId).toBe(replyId); // until it actually plays

    const hooks = speakBlobMock.mock.calls[0][1]!;
    expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_SOUND_OFF_HINT);
    act(() => hooks.onStart?.('server'));
    expect(result.current.blockedReplyId).toBeNull();
    // "Sound is off until you tap." is no longer true once it is playing.
    expect(result.current.voiceNotice).toBeNull();
    expect(result.current.voice).toBe('speaking');
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_reply_spoken', { mode: 'server' });
    act(() => hooks.onEnd?.());
    expect(result.current.voice).toBe('idle');

    // The next reply is simply requested and played like any other.
    speakMock.mockClear();
    postChatMock.mockResolvedValueOnce(okChat('Next.'));
    await act(async () => {
      await result.current.send('next');
    });
    expect(speakMock).toHaveBeenCalledTimes(1);
      });

  it('if even the tap is refused the pill stays, with the same audio', async () => {
    const { result } = await serverWithSpeech();
    const { audio, replyId } = await blockedReply(result);
    act(() => result.current.playBlocked());
    act(() => speakBlobMock.mock.calls[0][1]!.onBlocked?.(audio));
    expect(result.current.blockedReplyId).toBe(replyId);
    act(() => result.current.playBlocked());
    expect(speakBlobMock).toHaveBeenCalledTimes(2);
    expect(speakBlobMock.mock.calls[1][0]).toBe(audio);
  });

  it('turning sound off removes the pill', async () => {
    const { result } = await serverWithSpeech();
    await blockedReply(result);
    act(() => result.current.setSpeakEnabled(false));
    expect(result.current.blockedReplyId).toBeNull();
    act(() => result.current.playBlocked());
    expect(speakBlobMock).not.toHaveBeenCalled();
  });

  it('does nothing when there is nothing held', async () => {
    const { result } = await serverWithSpeech();
    act(() => result.current.playBlocked());
    expect(speakBlobMock).not.toHaveBeenCalled();
  });
});
