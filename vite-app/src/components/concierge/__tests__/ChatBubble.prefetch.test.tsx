import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import ChatBubble, { type PanelLoader } from '../ChatBubble';
import type { ChatPanelProps } from '../ChatPanel';
import * as copy from '../copy';

// The panel chunk is fetched in the background, but never while the page is still
// painting (the hero headline is the LCP element): at least 4 s after `load`, and
// then only when the browser is idle.

const DELAY = 4000;

function FakePanel({ open }: ChatPanelProps) {
  return (
    <div role="dialog" aria-label="Fake panel" hidden={!open}>
      fake panel
    </div>
  );
}

const makeLoader = () => vi.fn<PanelLoader>(() => Promise.resolve({ default: FakePanel }));

const setReadyState = (state: DocumentReadyState) =>
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => state });

describe('background prefetch of the panel chunk', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup(); // unmount while the stubbed idle-callback globals still exist
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'readyState');
    Reflect.deleteProperty(window, 'requestIdleCallback');
    Reflect.deleteProperty(window, 'cancelIdleCallback');
  });

  it('starts no import before 4 seconds after load, then runs it (browsers without requestIdleCallback)', () => {
    const loader = makeLoader();
    render(<ChatBubble panelLoader={loader} />);

    vi.advanceTimersByTime(250);
    expect(loader).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DELAY - 250 - 1);
    expect(loader).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('after the 4 second wait it asks the browser for an idle moment, with the same 5 s timeout', () => {
    let idleTask: (() => void) | undefined;
    const requestIdleCallback = vi.fn((cb: () => void) => {
      idleTask = cb;
      return 7;
    });
    vi.stubGlobal('requestIdleCallback', requestIdleCallback);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const loader = makeLoader();
    render(<ChatBubble panelLoader={loader} />);

    vi.advanceTimersByTime(DELAY - 1);
    expect(requestIdleCallback).not.toHaveBeenCalled();
    expect(loader).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 5000 });
    expect(loader).not.toHaveBeenCalled(); // waiting for the browser to be idle

    idleTask?.();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('counts the 4 seconds from the load event when the page is still loading', () => {
    setReadyState('loading');
    const loader = makeLoader();
    render(<ChatBubble panelLoader={loader} />);

    vi.advanceTimersByTime(60_000); // a slow page: nothing happens until it has loaded
    expect(loader).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event('load'));
    });
    vi.advanceTimersByTime(DELAY - 1);
    expect(loader).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('can be cancelled: unmounting before the mark never starts the import', () => {
    const loader = makeLoader();
    const { unmount } = render(<ChatBubble panelLoader={loader} />);
    vi.advanceTimersByTime(DELAY - 100);
    unmount();
    vi.advanceTimersByTime(DELAY * 3);
    expect(loader).not.toHaveBeenCalled();
  });

  it('cancels a pending idle callback on unmount too', () => {
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal('requestIdleCallback', vi.fn(() => 42));
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallback);
    const { unmount } = render(<ChatBubble panelLoader={makeLoader()} />);
    vi.advanceTimersByTime(DELAY);
    unmount();
    expect(cancelIdleCallback).toHaveBeenCalledWith(42);
  });

  it('cancels while still waiting for the load event', () => {
    setReadyState('loading');
    const loader = makeLoader();
    const { unmount } = render(<ChatBubble panelLoader={loader} />);
    unmount();
    act(() => {
      window.dispatchEvent(new Event('load'));
    });
    vi.advanceTimersByTime(DELAY * 2);
    expect(loader).not.toHaveBeenCalled();
  });

  it('a click before the mark still loads the panel on demand', async () => {
    const loader = makeLoader();
    render(<ChatBubble panelLoader={loader} />);
    vi.advanceTimersByTime(500);
    expect(loader).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: copy.BUBBLE_LABEL }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(loader).toHaveBeenCalledTimes(1); // the lazy import, not the prefetch
    expect(screen.getByRole('dialog', { name: 'Fake panel' })).toBeInTheDocument();
  });
});
