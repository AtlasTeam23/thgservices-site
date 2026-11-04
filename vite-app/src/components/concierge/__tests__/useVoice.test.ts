import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
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
vi.mock('../voice/recorder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../voice/recorder')>()),
  isRecordingSupported: vi.fn(),
  startRecording: vi.fn(),
}));
vi.mock('../voice/speech', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../voice/speech')>()),
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
  unlockSpeech: vi.fn(),
  isSpeechSupported: vi.fn(),
}));

import { fetchTts, fetchVoiceCaps, postChat, postStt } from '../api';
import { getToken } from '../turnstile';
import { track } from '../../../lib/track';
import { isRecordingSupported, startRecording, VoiceError } from '../voice/recorder';
import { isSpeechSupported, speak, stopSpeaking, unlockSpeech } from '../voice/speech';
import { useConcierge } from '../useConcierge';
import { EMPTY_LEAD_DRAFT } from '../leadDraft';
import { STORAGE_KEY } from '../storage';
import { VOICE_PREFS_KEY } from '../voice/prefs';
import * as copy from '../copy';
import * as voiceCopy from '../voice/copy';

const postChatMock = vi.mocked(postChat);
const postSttMock = vi.mocked(postStt);
const fetchTtsMock = vi.mocked(fetchTts);
const fetchCapsMock = vi.mocked(fetchVoiceCaps);
const getTokenMock = vi.mocked(getToken);
const trackMock = vi.mocked(track);
const supportedMock = vi.mocked(isRecordingSupported);
const startRecordingMock = vi.mocked(startRecording);
const speakMock = vi.mocked(speak);
const stopSpeakingMock = vi.mocked(stopSpeaking);
const unlockMock = vi.mocked(unlockSpeech);
const speechSupportedMock = vi.mocked(isSpeechSupported);

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

/** A recording the test finishes by hand. */
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
  return { recording, blob, mime, durationMs, finish: resolve };
}

const open = async (result: Hook) => {
  await act(async () => {
    await result.current.handleOpen({ source: 'bubble' });
  });
  await settle();
};

/** Open the chat on a browser where voice works. */
const openWithVoice = async (tts: 'browser' | 'aura' = 'browser') => {
  supportedMock.mockReturnValue(true);
  fetchCapsMock.mockResolvedValue({ tts });
  const hook = setup();
  await open(hook.result);
  return hook;
};

const press = async (result: Hook, opts?: { hold?: boolean }) => {
  await act(async () => {
    await result.current.startVoice(opts);
  });
};

/** Press, release, and let the transcript go through. */
const talk = async (result: Hook, rec = fakeRecording()) => {
  startRecordingMock.mockResolvedValue(rec.recording);
  await press(result);
  await act(async () => {
    result.current.stopVoice();
  });
  await settle();
  return rec;
};

/** A startRecording that stays pending (the permission prompt is open) until the test answers it. */
function deferredStart() {
  let grant!: (r: Recording) => void;
  let refuse!: (e: unknown) => void;
  const promise = new Promise<Recording>((resolve, reject) => {
    grant = resolve;
    refuse = reject;
  });
  startRecordingMock.mockReturnValue(promise);
  return { grant, refuse };
}

const voiceEvents = () =>
  trackMock.mock.calls.filter(([name]) => String(name).startsWith('concierge_voice'));

const storedPrefs = () => JSON.parse(window.sessionStorage.getItem(VOICE_PREFS_KEY) ?? 'null');

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  getTokenMock.mockResolvedValue(null);
  postChatMock.mockResolvedValue(okChat('We help local businesses save time.'));
  postSttMock.mockResolvedValue(okStt('what do you do'));
  fetchCapsMock.mockResolvedValue({ tts: 'browser' });
  supportedMock.mockReturnValue(false);
  speechSupportedMock.mockReturnValue(true);
  startRecordingMock.mockReset();
});

// ---- Availability ------------------------------------------------------------

describe('voice availability', () => {
  it('stays off, without asking the Worker, when the browser cannot record', async () => {
    const { result } = setup();
    await open(result);
    expect(result.current.voice).toBe('off');
    expect(fetchCapsMock).not.toHaveBeenCalled();
  });

  it('turns on once the Worker says speech to text is available', async () => {
    supportedMock.mockReturnValue(true);
    const { result } = setup();
    expect(result.current.voice).toBe('off');
    await open(result);
    expect(fetchCapsMock).toHaveBeenCalledTimes(1);
    expect(result.current.voice).toBe('idle');
  });

  it('checks only once, however many times the chat opens', async () => {
    const { result } = await openWithVoice();
    await open(result);
    await open(result);
    expect(fetchCapsMock).toHaveBeenCalledTimes(1);
  });

  it('stays off when the Worker says no or cannot be reached', async () => {
    supportedMock.mockReturnValue(true);
    fetchCapsMock.mockResolvedValue(null);
    const { result } = setup();
    await open(result);
    expect(result.current.voice).toBe('off');
    await press(result);
    expect(startRecordingMock).not.toHaveBeenCalled();
  });
});

// ---- Recording and transcript ------------------------------------------------

describe('voice: pressing the mic', () => {
  it('starts recording, unlocks speech inside the tap, and tracks the start', async () => {
    const { result } = await openWithVoice();
    const rec = fakeRecording();
    startRecordingMock.mockResolvedValue(rec.recording);

    // startVoice must unlock speech synchronously, before any await.
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.startVoice();
    });
    expect(unlockMock).toHaveBeenCalledTimes(1);
    expect(stopSpeakingMock).toHaveBeenCalled();
    await act(async () => {
      await pending;
    });

    expect(startRecordingMock).toHaveBeenCalledTimes(1);
    expect(startRecordingMock.mock.calls[0][0]).toEqual({
      onLevel: expect.any(Function),
      onEnding: expect.any(Function),
    });
    expect(result.current.voice).toBe('recording');
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_start');
  });

  it('clears an old voice message when a new recording starts', async () => {
    const { result } = await openWithVoice();
    startRecordingMock.mockRejectedValueOnce(new VoiceError('permission'));
    await press(result);
    expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_DENIED);
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await press(result);
    expect(result.current.voiceNotice).toBeNull();
  });

  it('does nothing while a recording is running or a reply is pending', async () => {
    const { result } = await openWithVoice();
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await press(result);
    await press(result); // already recording
    expect(startRecordingMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.cancelVoice();
    });
    postChatMock.mockReturnValue(new Promise(() => {})); // a reply that never comes
    await act(async () => {
      void result.current.send('hello');
    });
    expect(result.current.status).toBe('sending');
    await press(result);
    expect(startRecordingMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing once the chat has ended, or while it is in lead-only mode', async () => {
    const UUID = '11111111-1111-4111-8111-111111111111';
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sessionId: UUID, messages: [], leadSubmitted: false, ended: true, utm: {} })
    );
    const ended = await openWithVoice();
    expect(ended.result.current.status).toBe('ended');
    expect(ended.result.current.voice).toBe('idle'); // voice itself is available...
    await press(ended.result);
    expect(startRecordingMock).not.toHaveBeenCalled(); // ...but a finished chat does not take it
    expect(ended.result.current.voice).toBe('idle');

    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessionId: UUID,
        messages: [
          { id: 'a', role: 'assistant', content: copy.LEAD_ONLY, at: '2026-11-04T10:00:00.000Z' },
        ],
        leadSubmitted: false,
        ended: false,
        utm: {},
      })
    );
    const leadOnly = await openWithVoice();
    expect(leadOnly.result.current.status).toBe('leadOnly');
    await press(leadOnly.result);
    expect(startRecordingMock).not.toHaveBeenCalled();
  });
});

describe('voice: transcript', () => {
  it('sends the transcript through the normal chat flow, once', async () => {
    const { result } = await openWithVoice();
    const rec = await talk(result);

    expect(rec.recording.stop).toHaveBeenCalledTimes(1);
    expect(postSttMock).toHaveBeenCalledTimes(1);
    expect(postSttMock).toHaveBeenCalledWith(
      rec.blob,
      rec.mime,
      result.current.sessionId,
      null,
      rec.durationMs
    );
    expect(postChatMock).toHaveBeenCalledTimes(1);
    expect(postChatMock.mock.calls[0][0].messages.at(-1)).toEqual({
      role: 'user',
      content: 'what do you do',
    });
    expect(result.current.messages.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(result.current.messages.at(-1)?.content).toBe('We help local businesses save time.');
    expect(result.current.voice).toBe('idle');
    expect(result.current.voiceNotice).toBeNull();
    expect(trackMock).toHaveBeenCalledWith('concierge_message_sent', { turn_number: 1 });
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_transcribed', { seconds: 3 });
  });

  it('shows "Transcribing…" state while the Worker works', async () => {
    const { result } = await openWithVoice();
    let resolveStt!: (r: SttResult) => void;
    postSttMock.mockReturnValue(
      new Promise((r) => {
        resolveStt = r;
      })
    );
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await press(result);
    await act(async () => {
      result.current.stopVoice();
    });
    await settle();
    expect(result.current.voice).toBe('transcribing');
    expect(postChatMock).not.toHaveBeenCalled();
    resolveStt(okStt('hello'));
    await settle();
    expect(result.current.voice).toBe('idle');
    expect(postChatMock).toHaveBeenCalledTimes(1);
  });

  it('an empty transcript shows the "didn\'t catch that" copy and sends nothing', async () => {
    postSttMock.mockResolvedValue(okStt('   '));
    const { result } = await openWithVoice();
    await talk(result);
    expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_HEARD_NOTHING);
    expect(result.current.voice).toBe('idle');
    expect(postChatMock).not.toHaveBeenCalled();
    expect(result.current.messages.some((m) => m.role === 'user')).toBe(false);
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_empty');
    expect(trackMock).not.toHaveBeenCalledWith('concierge_voice_transcribed', expect.anything());
  });

  it('a clip with no audio, or too short to be speech, is not sent to the Worker', async () => {
    const { result } = await openWithVoice();
    await talk(result, fakeRecording(150));
    expect(postSttMock).not.toHaveBeenCalled();
    expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_HEARD_NOTHING);

    // A touch tap-and-release that did record a moment gets the press-and-hold hint instead.
    startRecordingMock.mockResolvedValue(fakeRecording(150).recording);
    await press(result, { hold: true });
    await act(async () => {
      result.current.stopVoice();
    });
    await settle();
    expect(postSttMock).not.toHaveBeenCalled();
    expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_HOLD_HINT);

    // The recorder had nothing at all.
    const none = fakeRecording();
    startRecordingMock.mockResolvedValue(none.recording);
    await press(result);
    await act(async () => {
      none.finish(null);
    });
    await settle();
    expect(postSttMock).not.toHaveBeenCalled();
    expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_HEARD_NOTHING);
    expect(result.current.voice).toBe('idle');
  });

  it('a touch released before the recorder exists (the permission prompt) gets the hold hint; a click gets "didn\'t catch that"', async () => {
    const { result } = await openWithVoice();
    for (const [hold, notice] of [
      [true, voiceCopy.VOICE_HOLD_HINT],
      [false, voiceCopy.VOICE_HEARD_NOTHING],
    ] as const) {
      const start = deferredStart();
      const rec = fakeRecording();
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.startVoice({ hold });
      });
      act(() => result.current.stopVoice()); // released while the recorder is still being set up
      expect(result.current.voiceNotice).toBeNull(); // nothing yet: there is no clip to judge
      start.grant(rec.recording);
      await act(async () => {
        await pending;
      });
      expect(rec.recording.cancel).toHaveBeenCalledTimes(1);
      expect(result.current.voice).toBe('idle');
      expect(result.current.voiceNotice).toBe(notice);
      expect(postSttMock).not.toHaveBeenCalled();
    }
  });

  it('a recording that ends by itself (the 20 s cap) is transcribed like any other', async () => {
    const { result } = await openWithVoice();
    const rec = fakeRecording(20000);
    startRecordingMock.mockResolvedValue(rec.recording);
    await press(result);

    const options = startRecordingMock.mock.calls[0][0]!;
    expect(result.current.voiceEnding).toBe(false);
    act(() => options.onEnding?.());
    expect(result.current.voiceEnding).toBe(true);

    await act(async () => {
      rec.finish({ blob: rec.blob, mime: rec.mime, durationMs: 20000 });
    });
    await settle();
    expect(postSttMock).toHaveBeenCalled();
    expect(result.current.voiceEnding).toBe(false);
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_transcribed', { seconds: 20 });
  });

  it('passes the input level to subscribers, outside React state, until they unsubscribe', async () => {
    const { result } = await openWithVoice();
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await press(result);
    const levels: number[] = [];
    const off = result.current.subscribeLevel((l) => levels.push(l));
    const { onLevel } = startRecordingMock.mock.calls[0][0]!;
    onLevel!(0.4);
    onLevel!(0.9);
    off();
    onLevel!(0.1);
    expect(levels).toEqual([0.4, 0.9]);
  });

  it('asks Turnstile for a token from the 11th message on, like /chat', async () => {
    getTokenMock.mockResolvedValue('tok-11');
    const { result } = await openWithVoice();
    for (let i = 1; i <= 10; i += 1) {
      await act(async () => {
        await result.current.send(`m${i}`);
      });
    }
    expect(getTokenMock).not.toHaveBeenCalled();
    await talk(result);
    // One token for /stt and a fresh one for the /chat call that follows (tokens are single-use).
    expect(getTokenMock).toHaveBeenCalledTimes(2);
    expect(postSttMock.mock.calls[0][3]).toBe('tok-11');
    expect(postChatMock.mock.calls.at(-1)![0].turnstileToken).toBe('tok-11');
  });

  it('on verification_required fetches a token and retries once', async () => {
    postSttMock
      .mockResolvedValueOnce({ kind: 'verification_required' })
      .mockResolvedValueOnce(okStt('what do you do'));
    getTokenMock.mockResolvedValue('fresh');
    const { result } = await openWithVoice();
    await talk(result);
    expect(postSttMock).toHaveBeenCalledTimes(2);
    expect(postSttMock.mock.calls[1][3]).toBe('fresh');
    expect(postChatMock).toHaveBeenCalledTimes(1);
  });

  it('shows the error copy if the retry also demands verification, or no token can be had', async () => {
    postSttMock.mockResolvedValue({ kind: 'verification_required' });
    getTokenMock.mockResolvedValue('fresh');
    const { result } = await openWithVoice();
    await talk(result);
    expect(postSttMock).toHaveBeenCalledTimes(2);
    expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_ERROR);
    expect(postChatMock).not.toHaveBeenCalled();

    postSttMock.mockClear();
    getTokenMock.mockResolvedValue(null);
    await talk(result);
    expect(postSttMock).toHaveBeenCalledTimes(1);
    expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_ERROR);
  });
});

// ---- Failures ----------------------------------------------------------------

describe('voice: failures', () => {
  it('permission denied: shows the blocked-microphone copy, tracks it, and keeps the mic', async () => {
    startRecordingMock.mockRejectedValue(new VoiceError('permission'));
    const { result } = await openWithVoice();
    await press(result);
    expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_DENIED);
    expect(result.current.voice).toBe('idle');
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_error', { reason: 'permission' });
    expect(trackMock).not.toHaveBeenCalledWith('concierge_voice_start');
    expect(postSttMock).not.toHaveBeenCalled();
  });

  it('no microphone: hides voice for the session', async () => {
    startRecordingMock.mockRejectedValue(new VoiceError('unsupported'));
    const { result } = await openWithVoice();
    await press(result);
    expect(result.current.voice).toBe('off');
    expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_NO_MIC);
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_error', { reason: 'unsupported' });
  });

  it('a busy microphone: says so but leaves the button for another try', async () => {
    startRecordingMock.mockRejectedValue(new VoiceError('device'));
    const { result } = await openWithVoice();
    await press(result);
    expect(result.current.voice).toBe('idle');
    expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_NO_MIC);
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_error', { reason: 'unsupported' });
  });

  it('voice_unavailable (budget): hides the mic and says voice is taking a break, once', async () => {
    postSttMock.mockResolvedValue({ kind: 'voice_unavailable', reason: 'budget' });
    const { result } = await openWithVoice();
    await talk(result);
    expect(result.current.voice).toBe('off');
    expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_OFF);
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_error', { reason: 'budget' });
    expect(postChatMock).not.toHaveBeenCalled();

    startRecordingMock.mockClear();
    await press(result);
    expect(startRecordingMock).not.toHaveBeenCalled();
  });

  it('voice_unavailable (server): same for this visit, tracked as "server", but not remembered for the tab', async () => {
    postSttMock.mockResolvedValue({ kind: 'voice_unavailable', reason: 'server' });
    const { result } = await openWithVoice();
    await talk(result);
    expect(result.current.voice).toBe('off');
    expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_OFF);
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_error', { reason: 'server' });
    expect(trackMock).not.toHaveBeenCalledWith('concierge_voice_error', { reason: 'budget' });
    expect(storedPrefs()?.blocked).toBeUndefined();

    // A later page load in the same tab asks again.
    fetchCapsMock.mockClear();
    const again = await openWithVoice();
    expect(fetchCapsMock).toHaveBeenCalledTimes(1);
    expect(again.result.current.voice).toBe('idle');
  });

  it('a spent budget is remembered for the tab: a reload shows no mic and does not even ask the Worker', async () => {
    postSttMock.mockResolvedValue({ kind: 'voice_unavailable', reason: 'budget' });
    const { result } = await openWithVoice();
    await talk(result);
    expect(storedPrefs()).toMatchObject({ blocked: true });

    fetchCapsMock.mockClear();
    supportedMock.mockReturnValue(true);
    const again = setup();
    await open(again.result);
    expect(again.result.current.voice).toBe('off');
    expect(fetchCapsMock).not.toHaveBeenCalled();
    await press(again.result);
    expect(startRecordingMock).toHaveBeenCalledTimes(1); // only the first controller's press
  });

  it('server and network trouble: error copy, tracked as "server", chat untouched', async () => {
    const { result } = await openWithVoice();
    for (const res of [
      { kind: 'error', reason: 'network' },
      { kind: 'error', reason: 'timeout' },
      { kind: 'error', reason: 'server' },
      { kind: 'bad_audio' },
    ] as SttResult[]) {
      trackMock.mockClear();
      postSttMock.mockResolvedValueOnce(res);
      await talk(result);
      expect(result.current.voiceNotice, JSON.stringify(res)).toBe(voiceCopy.VOICE_ERROR);
      expect(result.current.voice).toBe('idle');
      expect(trackMock).toHaveBeenCalledWith('concierge_voice_error', { reason: 'server' });
    }
    expect(postChatMock).not.toHaveBeenCalled();
  });

  it('a thrown request is treated as a network error', async () => {
    postSttMock.mockRejectedValue(new Error('boom'));
    const { result } = await openWithVoice();
    await talk(result);
    expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_ERROR);
    expect(result.current.voice).toBe('idle');
  });

  it('rate limited: the same hand-off to the phone as a rate-limited chat', async () => {
    postSttMock.mockResolvedValue({ kind: 'rate_limited' });
    const { result } = await openWithVoice();
    await talk(result);
    expect(result.current.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: copy.RATE_LIMITED,
    });
    expect(trackMock).toHaveBeenCalledWith('concierge_rate_limited');
    expect(result.current.voice).toBe('idle');
    expect(postChatMock).not.toHaveBeenCalled();
  });
});

// ---- Cancelling --------------------------------------------------------------

describe('voice: cancelling', () => {
  it('cancelVoice discards a recording in progress without sending anything', async () => {
    const { result } = await openWithVoice();
    const rec = fakeRecording();
    startRecordingMock.mockResolvedValue(rec.recording);
    await press(result);
    await act(async () => {
      result.current.cancelVoice();
    });
    await settle();
    expect(rec.recording.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.voice).toBe('idle');
    expect(result.current.voiceEnding).toBe(false);
    expect(postSttMock).not.toHaveBeenCalled();
    expect(result.current.voiceNotice).toBeNull();
  });

  it('cancelVoice while transcribing drops the transcript when it arrives', async () => {
    const { result } = await openWithVoice();
    let resolveStt!: (r: SttResult) => void;
    postSttMock.mockReturnValue(
      new Promise((r) => {
        resolveStt = r;
      })
    );
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await press(result);
    await act(async () => {
      result.current.stopVoice();
    });
    await settle();
    expect(result.current.voice).toBe('transcribing');

    await act(async () => {
      result.current.cancelVoice();
    });
    expect(result.current.voice).toBe('idle');
    resolveStt(okStt('too late'));
    await settle();
    expect(postChatMock).not.toHaveBeenCalled();
    expect(result.current.messages.some((m) => m.content === 'too late')).toBe(false);
  });

  it('a release that lands while the permission prompt is still open cancels the recording', async () => {
    const { result } = await openWithVoice();
    const rec = fakeRecording();
    let grant!: (r: Recording) => void;
    startRecordingMock.mockReturnValue(
      new Promise((r) => {
        grant = r;
      })
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.startVoice();
    });
    expect(result.current.voice).toBe('recording');
    act(() => result.current.stopVoice()); // released before the prompt was answered
    grant(rec.recording);
    await act(async () => {
      await pending;
    });
    await settle();
    expect(rec.recording.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.voice).toBe('idle');
    expect(postSttMock).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalledWith('concierge_voice_start');
  });

  it('stopAll ends the recording and the reading aloud (the panel was closed)', async () => {
    const { result } = await openWithVoice();
    const rec = fakeRecording();
    startRecordingMock.mockResolvedValue(rec.recording);
    await press(result);
    stopSpeakingMock.mockClear();
    await act(async () => {
      result.current.stopAll();
    });
    expect(rec.recording.cancel).toHaveBeenCalled();
    expect(stopSpeakingMock).toHaveBeenCalled();
    expect(result.current.voice).toBe('idle');
  });

  it('using a quick-reply chip while recording discards the recording', async () => {
    const { result } = await openWithVoice();
    const rec = fakeRecording();
    startRecordingMock.mockResolvedValue(rec.recording);
    await press(result);
    await act(async () => {
      await result.current.chip('What do you do?');
    });
    expect(rec.recording.cancel).toHaveBeenCalled();
    expect(postSttMock).not.toHaveBeenCalled();
    expect(postChatMock).toHaveBeenCalledTimes(1);
  });
});

// ---- Reading replies aloud ---------------------------------------------------

describe('voice: reading replies aloud', () => {
  it('is off until the first voice use, then on, and remembered for the tab', async () => {
    const { result } = await openWithVoice();
    expect(result.current.speakEnabled).toBe(false);
    expect(result.current.voiceDisclosed).toBe(false);
    expect(window.sessionStorage.getItem(VOICE_PREFS_KEY)).toBeNull();

    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await press(result);
    expect(result.current.speakEnabled).toBe(true);
    expect(result.current.voiceDisclosed).toBe(true);
    expect(storedPrefs()).toEqual({ speak: true, disclosed: true });

    // A fresh controller in the same tab (panel remounted, page reloaded): reading aloud is
    // remembered, the microphone line is not shown a second time.
    const again = await openWithVoice();
    expect(again.result.current.speakEnabled).toBe(true);
    expect(again.result.current.voiceDisclosed).toBe(false);
  });

  it('the microphone line shows from the first use until the panel closes, and is not shown again', async () => {
    const { result } = await openWithVoice();
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await press(result);
    expect(result.current.voiceDisclosed).toBe(true);
    await act(async () => {
      result.current.stopAll(); // the panel was closed
    });
    expect(result.current.voiceDisclosed).toBe(false);

    // The next press, in the same tab, does not bring it back.
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await press(result);
    expect(result.current.voiceDisclosed).toBe(false);
  });

  it('a first press that is refused sets nothing: no disclosure, reading aloud stays off, nothing stored', async () => {
    startRecordingMock.mockRejectedValue(new VoiceError('permission'));
    const { result } = await openWithVoice();
    await press(result);
    expect(result.current.voiceNotice).toBe(voiceCopy.VOICE_DENIED);
    expect(result.current.voiceDisclosed).toBe(false);
    expect(result.current.speakEnabled).toBe(false);
    expect(window.sessionStorage.getItem(VOICE_PREFS_KEY)).toBeNull();

    // The press that works afterwards is the first use.
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await press(result);
    expect(result.current.voiceDisclosed).toBe(true);
    expect(result.current.speakEnabled).toBe(true);
    expect(storedPrefs()).toEqual({ speak: true, disclosed: true });
  });

  it('a first press let go before the microphone was ready is not a first use either', async () => {
    const { result } = await openWithVoice();
    const start = deferredStart();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.startVoice({ hold: true });
    });
    act(() => result.current.stopVoice());
    start.grant(fakeRecording().recording);
    await act(async () => {
      await pending;
    });
    expect(result.current.voiceDisclosed).toBe(false);
    expect(result.current.speakEnabled).toBe(false);
    expect(window.sessionStorage.getItem(VOICE_PREFS_KEY)).toBeNull();
  });

  it('does not override a choice the visitor already made', async () => {
    const { result } = await openWithVoice();
    act(() => result.current.setSpeakEnabled(false));
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await press(result);
    expect(result.current.speakEnabled).toBe(false);
    expect(result.current.voiceDisclosed).toBe(true);
    expect(storedPrefs()).toEqual({ speak: false, disclosed: true });
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
    const [text, mode, hooks] = speakMock.mock.calls[0];
    expect(text).toBe('We help local businesses save time.');
    expect(mode).toBe('browser');

    act(() => hooks!.onStart?.('browser'));
    expect(result.current.voice).toBe('speaking');
    expect(trackMock).toHaveBeenCalledWith('concierge_voice_reply_spoken', { mode: 'browser' });

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
    expect(speakMock).toHaveBeenCalledWith(copy.HANDOFF, 'browser', expect.anything());
  });

  it('does not speak when reading aloud is off, voice is off, or speech is unsupported', async () => {
    const { result } = await openWithVoice();
    await act(async () => {
      await result.current.send('hello');
    });
    expect(speakMock).not.toHaveBeenCalled();

    act(() => result.current.setSpeakEnabled(true));
    speechSupportedMock.mockReturnValue(false);
    await act(async () => {
      await result.current.send('hello again');
    });
    expect(speakMock).not.toHaveBeenCalled();

    // Voice off for the whole session (no microphone): nothing is read either, even if it was on.
    speechSupportedMock.mockReturnValue(true);
    supportedMock.mockReturnValue(false);
    window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: true, disclosed: true }));
    const off = setup();
    await open(off.result);
    expect(off.result.current.voice).toBe('off');
    await act(async () => {
      await off.result.current.send('hello');
    });
    expect(speakMock).not.toHaveBeenCalled();
  });

  it('a typed message sent while recording discards the recording', async () => {
    const { result } = await openWithVoice();
    const rec = fakeRecording();
    startRecordingMock.mockResolvedValue(rec.recording);
    await press(result);
    await act(async () => {
      await result.current.send('I typed this instead');
    });
    expect(rec.recording.cancel).toHaveBeenCalledTimes(1);
    expect(postSttMock).not.toHaveBeenCalled();
    expect(postChatMock).toHaveBeenCalledTimes(1);
    expect(result.current.voice).toBe('idle');
  });

  it('any new input stops the reading: send, chip, a press of the mic, or stopSpeaking()', async () => {
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

  it('uses the premium voice when /health says aura, fetching the audio with the session id', async () => {
    const { result } = await openWithVoice('aura');
    act(() => result.current.setSpeakEnabled(true));
    expect(unlockMock).toHaveBeenLastCalledWith('aura');
    await act(async () => {
      await result.current.send('hello');
    });
    const [text, mode, hooks] = speakMock.mock.calls[0];
    expect(mode).toBe('aura');

    const blob = new Blob([new Uint8Array(3)], { type: 'audio/mpeg' });
    fetchTtsMock.mockResolvedValueOnce({ kind: 'ok', blob });
    expect(await hooks!.fetchAudio!(text)).toBe(blob);
    expect(fetchTtsMock).toHaveBeenCalledWith(text, result.current.sessionId);

    fetchTtsMock.mockResolvedValueOnce({ kind: 'unavailable' });
    expect(await hooks!.fetchAudio!(text)).toBeNull();
  });

  it('the browser voice never asks the Worker for audio', async () => {
    const { result } = await openWithVoice('browser');
    act(() => result.current.setSpeakEnabled(true));
    await act(async () => {
      await result.current.send('hello');
    });
    expect(speakMock.mock.calls[0][2]?.fetchAudio).toBeUndefined();
    expect(fetchTtsMock).not.toHaveBeenCalled();
  });
});

// ---- Privacy -----------------------------------------------------------------

describe('voice: analytics hygiene', () => {
  it('never puts audio, transcripts or message text in a tracked parameter', async () => {
    postSttMock.mockResolvedValue(okStt('my number is 770 555 0147'));
    const { result } = await openWithVoice();
    act(() => result.current.setSpeakEnabled(true));
    await talk(result);
    act(() => speakMock.mock.calls[0][2]!.onStart?.('browser'));

    const events = voiceEvents();
    expect(events.length).toBeGreaterThanOrEqual(3);
    for (const [name, params] of events) {
      for (const [key, value] of Object.entries(params ?? {})) {
        expect(['seconds', 'mode', 'reason'], `${String(name)}.${key}`).toContain(key);
        expect(String(value)).not.toMatch(/770|number|saved/i);
      }
    }
    expect(JSON.stringify(trackMock.mock.calls)).not.toContain('770');
  });

  it('does not store the transcript in the voice preferences', async () => {
    postSttMock.mockResolvedValue(okStt('private words'));
    const { result } = await openWithVoice();
    await talk(result);
    expect(window.sessionStorage.getItem(VOICE_PREFS_KEY)).not.toContain('private');
    // The chat history (the visitor's own message) is stored as before; the voice key holds flags only.
    expect(Object.keys(storedPrefs()).sort()).toEqual(['disclosed', 'speak']);
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toContain('private words');
  });
});

// ---- Abandoned presses -------------------------------------------------------

describe('voice: a press abandoned while the permission prompt is open', () => {
  const abandon = {
    'cancelVoice (a typed message, a chip)': (r: Hook) => r.current.cancelVoice(),
    'stopAll (the panel was closed)': (r: Hook) => r.current.stopAll(),
    'cancelRecording (the tab was hidden)': (r: Hook) => r.current.cancelRecording(),
  };

  for (const [name, doIt] of Object.entries(abandon)) {
    it(`${name}: a recorder that arrives afterwards is cancelled at once and nothing is tracked`, async () => {
      const { result } = await openWithVoice();
      const start = deferredStart();
      const rec = fakeRecording();
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.startVoice();
      });
      expect(result.current.voice).toBe('recording');
      act(() => doIt(result));
      expect(result.current.voice).toBe('idle');

      start.grant(rec.recording);
      await act(async () => {
        await pending;
      });
      await settle();
      expect(rec.recording.cancel).toHaveBeenCalledTimes(1);
      expect(result.current.voice).toBe('idle');
      expect(trackMock).not.toHaveBeenCalledWith('concierge_voice_start');
      expect(postSttMock).not.toHaveBeenCalled();
    });

    it(`${name}: a refusal that arrives afterwards says nothing`, async () => {
      const { result } = await openWithVoice();
      const start = deferredStart();
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.startVoice();
      });
      act(() => doIt(result));
      start.refuse(new VoiceError('permission'));
      await act(async () => {
        await pending;
      });
      expect(result.current.voiceNotice).toBeNull();
      expect(result.current.voice).toBe('idle');
      expect(voiceEvents().filter(([n]) => n === 'concierge_voice_error')).toEqual([]);
    });
  }
});

describe('voice: a hidden tab stops the recording only', () => {
  it('cancelRecording discards a recording but lets a transcript that is already on its way finish', async () => {
    const { result } = await openWithVoice();
    let resolveStt!: (r: SttResult) => void;
    postSttMock.mockReturnValue(
      new Promise((r) => {
        resolveStt = r;
      })
    );
    startRecordingMock.mockResolvedValue(fakeRecording().recording);
    await press(result);
    await act(async () => {
      result.current.stopVoice();
    });
    await settle();
    expect(result.current.voice).toBe('transcribing');

    await act(async () => {
      result.current.cancelRecording();
    });
    expect(result.current.voice).toBe('transcribing');
    resolveStt(okStt('what do you do'));
    await settle();
    expect(postChatMock).toHaveBeenCalledTimes(1);
    expect(result.current.messages.some((m) => m.content === 'what do you do')).toBe(true);
    expect(result.current.voice).toBe('idle');
  });

  it('cancelRecording while recording discards the clip without a transcript or a message', async () => {
    const { result } = await openWithVoice();
    const rec = fakeRecording();
    startRecordingMock.mockResolvedValue(rec.recording);
    await press(result);
    await act(async () => {
      result.current.cancelRecording();
    });
    await settle();
    expect(rec.recording.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.voice).toBe('idle');
    expect(postSttMock).not.toHaveBeenCalled();
  });
});

// ---- Reading aloud only while the panel is in use ----------------------------

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

  it('closing the panel stops a reply that is being read', async () => {
    const { result } = await openWithVoice();
    act(() => result.current.setSpeakEnabled(true));
    await act(async () => {
      await result.current.send('hello');
    });
    act(() => speakMock.mock.calls[0][2]!.onStart?.('browser'));
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
  it('is available when the browser can speak', async () => {
    const { result } = await openWithVoice('browser');
    expect(result.current.speakAvailable).toBe(true);
  });

  it('is not when the browser cannot speak and the premium voice is off', async () => {
    speechSupportedMock.mockReturnValue(false);
    const { result } = await openWithVoice('browser');
    expect(result.current.voice).toBe('idle');
    expect(result.current.speakAvailable).toBe(false);
  });

  it('is, with the premium voice on, even where the browser cannot speak', async () => {
    speechSupportedMock.mockReturnValue(false);
    const { result } = await openWithVoice('aura');
    expect(result.current.speakAvailable).toBe(true);
  });

  it('is false while voice is off altogether', async () => {
    const { result } = setup();
    await open(result.current ? result : result);
    expect(result.current.voice).toBe('off');
    expect(result.current.speakAvailable).toBe(false);
  });
});

// ---- Analytics: exactly these events -----------------------------------------

describe('voice: analytics event names', () => {
  it('uses exactly the five concierge_voice_* events of the plan, whatever happens', async () => {
    const names = new Set<string>();
    const collect = () => {
      for (const [name] of voiceEvents()) names.add(String(name));
    };

    // Start, transcribed, reply_spoken.
    const happy = await openWithVoice();
    await talk(happy.result);
    act(() => speakMock.mock.calls[0][2]!.onStart?.('browser'));
    collect();

    // Empty transcript.
    postSttMock.mockResolvedValueOnce(okStt(''));
    await talk(happy.result);
    collect();

    // The four error reasons.
    startRecordingMock.mockRejectedValueOnce(new VoiceError('permission'));
    await press(happy.result);
    startRecordingMock.mockRejectedValueOnce(new VoiceError('device'));
    await press(happy.result);
    postSttMock.mockResolvedValueOnce({ kind: 'error', reason: 'server' });
    await talk(happy.result);
    postSttMock.mockResolvedValueOnce({ kind: 'voice_unavailable', reason: 'budget' });
    await talk(happy.result);
    collect();

    expect([...names].sort()).toEqual([
      'concierge_voice_empty',
      'concierge_voice_error',
      'concierge_voice_reply_spoken',
      'concierge_voice_start',
      'concierge_voice_transcribed',
    ]);
    const reasons = new Set(
      voiceEvents()
        .filter(([n]) => n === 'concierge_voice_error')
        .map(([, params]) => (params as { reason: string }).reason)
    );
    expect([...reasons].sort()).toEqual(['budget', 'permission', 'server', 'unsupported']);
  });
});
