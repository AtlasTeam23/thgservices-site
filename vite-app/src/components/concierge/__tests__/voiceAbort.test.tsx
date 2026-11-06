import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatResult } from '../api';

// Everything real except the network: the panel, the controller and the
// speech module, to prove that a /tts request that is no longer wanted is actually cancelled.
vi.mock('../api', () => ({
  postChat: vi.fn(),
  postLead: vi.fn(),
  fetchTts: vi.fn(),
  fetchVoiceCaps: vi.fn(),
}));
vi.mock('../turnstile', () => ({ getToken: vi.fn() }));
vi.mock('../../../lib/track', () => ({ track: vi.fn() }));
vi.mock('../../../hooks/useLenis', () => ({ getLenis: vi.fn() }));

import ChatPanel, { type OpenRequest } from '../ChatPanel';
import { fetchTts, fetchVoiceCaps, postChat } from '../api';
import { EMPTY_LEAD_DRAFT } from '../leadDraft';
import { VOICE_PREFS_KEY } from '../voice/prefs';
import { resetSpeech } from '../voice/speech';

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

function Harness({ open = true }: { open?: boolean }) {
  const bubbleRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={bubbleRef}>bubble</button>
      <ChatPanel
        open={open}
        request={{ id: 1, source: 'bubble' } as OpenRequest}
        onClose={() => {}}
        returnFocusRef={bubbleRef}
      />
    </>
  );
}

const signals: AbortSignal[] = [];

const settle = async () => {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const startAndAsk = async (text = 'hello') => {
  const user = userEvent.setup();
  const utils = render(<Harness />);
  await settle();
  await user.type(screen.getByRole('textbox', { name: 'Message' }), `${text}{Enter}`);
  await settle();
  return { user, ...utils };
};

beforeEach(() => {
  vi.clearAllMocks();
  resetSpeech();
  signals.length = 0;
  window.sessionStorage.clear();
  window.sessionStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ speak: true, disclosed: true }));
  vi.mocked(fetchVoiceCaps).mockResolvedValue({ tts: 'server' });
  vi.mocked(postChat).mockResolvedValue(okChat('A reply to read aloud.'));
  // A /tts request that never comes back, but notes the signal it was given.
  vi.mocked(fetchTts).mockImplementation(
    (_text, _session, signal) =>
      new Promise(() => {
        if (signal) signals.push(signal);
      })
  );
});

describe('an unwanted /tts request is aborted', () => {
  it('is out and live while the reply is being fetched', async () => {
    await startAndAsk();
    expect(vi.mocked(fetchTts)).toHaveBeenCalledTimes(1);
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);
  });

  it('when the panel is closed', async () => {
    const { rerender } = await startAndAsk();
    rerender(<Harness open={false} />);
    await settle();
    expect(signals[0].aborted).toBe(true);
  });

  it('when the panel is unmounted', async () => {
    const { unmount } = await startAndAsk();
    expect(signals[0].aborted).toBe(false);
    unmount();
    expect(signals[0].aborted).toBe(true);
  });

  it('when a newer reply replaces it', async () => {
    const { user } = await startAndAsk('first question');
    vi.mocked(postChat).mockResolvedValueOnce(okChat('A newer reply.'));
    // The first reply's audio is still out; the visitor asks again (which also counts as new input).
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'second question{Enter}');
    await settle();
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('when the visitor starts typing (any new input stops the reading)', async () => {
    const { user } = await startAndAsk();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'a');
    expect(signals[0].aborted).toBe(true);
  });

  it('when the tab is hidden', async () => {
    await startAndAsk();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();
    } finally {
      hidden.mockRestore();
    }
    expect(signals[0].aborted).toBe(true);
  });
});
