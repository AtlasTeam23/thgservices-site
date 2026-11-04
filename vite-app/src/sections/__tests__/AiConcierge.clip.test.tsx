import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/track', () => ({ track: vi.fn() }));
vi.mock('../../components/concierge', () => ({
  isConciergeEnabled: vi.fn(() => true),
  openConcierge: vi.fn(),
}));

import AiConcierge from '../AiConcierge';
import { isConciergeEnabled, openConcierge } from '../../components/concierge';

const DESKTOP = '(min-width: 900px)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const CARD_NAME = 'Try the AI Website Concierge';

const originalMatchMedia = window.matchMedia;

/** Make window.matchMedia report a match only for the listed queries. */
function matchOnly(...queries: string[]) {
  window.matchMedia = ((query: string) =>
    ({
      matches: queries.includes(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
}

const cardButton = () => screen.getByRole('button', { name: CARD_NAME });

describe('AiConcierge preview card clip', () => {
  let play: ReturnType<typeof vi.spyOn>;
  let pause: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isConciergeEnabled).mockReturnValue(true);
    window.history.replaceState({}, '', '/');
    // jsdom does not implement media playback.
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.matchMedia = originalMatchMedia;
    delete (document as { hidden?: boolean }).hidden;
  });

  describe('on desktop with motion allowed', () => {
    beforeEach(() => matchOnly(DESKTOP));

    it('shows the looping clip inside the button, with the poster, and no DOM mock', () => {
      const { container } = render(<AiConcierge />);
      const button = cardButton();
      const video = button.querySelector('video');
      expect(video).not.toBeNull();
      const source = video!.querySelector('source');
      expect(source?.getAttribute('src')?.endsWith('/concierge-card-loop.mp4')).toBe(true);
      expect(source).toHaveAttribute('type', 'video/mp4');
      expect(video!.getAttribute('poster')?.endsWith('/concierge-card-poster.jpg')).toBe(true);
      expect(video!.muted).toBe(true);
      expect(video!.loop).toBe(true);
      expect(video!.autoplay).toBe(true);
      expect(video).toHaveAttribute('playsinline');
      expect(video).toHaveAttribute('aria-hidden', 'true');
      expect(video).toHaveAttribute('preload', 'metadata');
      expect(video).toHaveAttribute('disablepictureinpicture');
      // The DOM mock is not rendered alongside it.
      expect(container.querySelector('.thg-cc-card')).toBeNull();
      expect(screen.queryByText('What do you do?')).not.toBeInTheDocument();
    });

    it('keeps the button, its name and the "Click to try it" pill; nothing inside is interactive', () => {
      render(<AiConcierge />);
      const button = cardButton();
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveClass('thg-cc-card-button');
      expect(button.querySelector('.thg-cc-card-pill')).toHaveTextContent('Click to try it');
      expect(button.querySelector('video')).not.toHaveAttribute('controls');
      expect(
        button.querySelectorAll('button, a, input, textarea, select, [tabindex], div, p, ol, ul, li')
      ).toHaveLength(0);
      // The whole clip is hidden from assistive tech: one named control, no stray media.
      expect(button.querySelector('.aic-clip')).toHaveAttribute('aria-hidden', 'true');
    });

    it('still opens the concierge when the clip card is clicked', async () => {
      const user = userEvent.setup();
      render(<AiConcierge />);
      await user.click(cardButton());
      expect(openConcierge).toHaveBeenCalledTimes(1);
      expect(openConcierge).toHaveBeenCalledWith({ source: 'section_cta', quickReply: 'Try the AI Concierge' });
    });

    it('opens the concierge from the keyboard too', async () => {
      const user = userEvent.setup();
      render(<AiConcierge />);
      cardButton().focus();
      await user.keyboard('{Enter}');
      expect(openConcierge).toHaveBeenCalledTimes(1);
    });

    it('starts playback on mount', () => {
      render(<AiConcierge />);
      expect(play).toHaveBeenCalled();
    });

    it('has no clip when the chat helper is switched off (the card is plain decoration)', () => {
      vi.mocked(isConciergeEnabled).mockReturnValue(false);
      const { container } = render(<AiConcierge />);
      expect(container.querySelector('video')).toBeNull();
      expect(screen.queryByRole('button', { name: CARD_NAME })).not.toBeInTheDocument();
      expect(container.querySelector('div.thg-cc-card')).not.toBeNull();
    });
  });

  describe('falls back to the DOM mock', () => {
    const expectMock = (container: HTMLElement) => {
      expect(container.querySelector('video')).toBeNull();
      const mock = cardButton().querySelector('.thg-cc-card');
      expect(mock).not.toBeNull();
      expect(mock).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByText('What do you do?')).toBeInTheDocument();
      expect(cardButton().querySelector('.thg-cc-card-pill')).toHaveTextContent('Click to try it');
    };

    it('when reduced motion is requested, even on desktop', () => {
      matchOnly(DESKTOP, REDUCED_MOTION);
      const { container } = render(<AiConcierge />);
      expectMock(container);
      expect(play).not.toHaveBeenCalled();
    });

    it('when the desktop query does not match (phones)', () => {
      matchOnly();
      const { container } = render(<AiConcierge />);
      expectMock(container);
    });

    it('when matchMedia is unavailable', () => {
      // @ts-expect-error simulating an old browser
      window.matchMedia = undefined;
      const { container } = render(<AiConcierge />);
      expectMock(container);
    });

    it('after the video fires an error', () => {
      matchOnly(DESKTOP);
      const { container } = render(<AiConcierge />);
      fireEvent.error(container.querySelector('video') as HTMLVideoElement);
      expectMock(container);
    });

    it('after the source fails to load', () => {
      matchOnly(DESKTOP);
      const { container } = render(<AiConcierge />);
      fireEvent.error(container.querySelector('video source') as HTMLSourceElement);
      expectMock(container);
    });

    it('when play() is rejected (autoplay blocked or media unsupported)', async () => {
      matchOnly(DESKTOP);
      play.mockImplementation(() => Promise.reject(new DOMException('blocked', 'NotAllowedError')));
      const { container } = render(<AiConcierge />);
      await waitFor(() => expect(container.querySelector('video')).toBeNull());
      expectMock(container);
    });

    it('but not when play() was only interrupted by a pause (AbortError)', async () => {
      matchOnly(DESKTOP);
      play.mockImplementation(() => Promise.reject(new DOMException('interrupted', 'AbortError')));
      const { container } = render(<AiConcierge />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(container.querySelector('video')).not.toBeNull();
    });

    it('and the fallback card still opens the concierge', async () => {
      matchOnly(DESKTOP);
      const user = userEvent.setup();
      const { container } = render(<AiConcierge />);
      fireEvent.error(container.querySelector('video') as HTMLVideoElement);
      await user.click(cardButton());
      expect(openConcierge).toHaveBeenCalledWith({ source: 'section_cta', quickReply: 'Try the AI Concierge' });
    });
  });

  describe('playback follows visibility', () => {
    type IOCallback = (entries: Array<Pick<IntersectionObserverEntry, 'isIntersecting'>>) => void;
    let callback: IOCallback;
    let disconnect: ReturnType<typeof vi.fn>;
    let observed: Element[];

    beforeEach(() => {
      matchOnly(DESKTOP);
      observed = [];
      disconnect = vi.fn();
      class FakeObserver {
        constructor(cb: IOCallback) {
          callback = cb;
        }
        observe = (el: Element) => {
          observed.push(el);
        };
        unobserve = () => {};
        disconnect = disconnect;
        takeRecords = () => [];
      }
      vi.stubGlobal('IntersectionObserver', FakeObserver);
    });

    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    };

    it('observes the clip, pauses it when it scrolls out of view and resumes it when it returns', () => {
      const { container } = render(<AiConcierge />);
      expect(observed).toEqual([container.querySelector('.aic-clip')]);

      pause.mockClear();
      play.mockClear();
      act(() => callback([{ isIntersecting: false }]));
      expect(pause).toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();

      act(() => callback([{ isIntersecting: true }]));
      expect(play).toHaveBeenCalled();
    });

    it('pauses while the tab is hidden and resumes when it is shown again', () => {
      render(<AiConcierge />);
      pause.mockClear();
      play.mockClear();

      setHidden(true);
      expect(pause).toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();

      setHidden(false);
      expect(play).toHaveBeenCalled();
    });

    it('stays paused when the tab becomes visible but the card is still off screen', () => {
      render(<AiConcierge />);
      act(() => callback([{ isIntersecting: false }]));
      setHidden(true);
      play.mockClear();
      setHidden(false);
      expect(play).not.toHaveBeenCalled();
    });

    it('stops observing and listening when it unmounts', () => {
      const removeSpy = vi.spyOn(document, 'removeEventListener');
      const { unmount } = render(<AiConcierge />);
      unmount();
      expect(disconnect).toHaveBeenCalled();
      expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });
  });
});
