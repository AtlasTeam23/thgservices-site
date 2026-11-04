import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The default loader (a dynamic import of ./ChatPanel) fails, as it does when the
// visitor is offline or holds a stale page after a deploy.
vi.mock('../ChatPanel', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

import ChatBubble, { type PanelLoader } from '../ChatBubble';
import type { ChatPanelProps } from '../ChatPanel';
import * as copy from '../copy';

const failure = () => new Error('Failed to fetch dynamically imported module');

function FakePanel({ open }: ChatPanelProps) {
  return (
    <div role="dialog" aria-label="Fake panel" hidden={!open}>
      fake panel
    </div>
  );
}

const bubble = () => screen.getByRole('button', { name: copy.BUBBLE_LABEL });

beforeEach(() => {
  window.sessionStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('when the panel chunk fails to load', () => {
  it('shows the phone fallback with retry and close instead of crashing the app', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <p>rest of the site</p>
        <ChatBubble />
      </div>
    );
    await user.click(bubble());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something hiccuped on our end.');
    expect(screen.getByRole('link', { name: copy.PHONE_DISPLAY })).toHaveAttribute(
      'href',
      copy.PHONE_HREF
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close chat' })).toBeInTheDocument();
    // The rest of the page and the bubble survive.
    expect(screen.getByText('rest of the site')).toBeInTheDocument();
    expect(bubble()).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows nothing until the visitor asks for the chat', async () => {
    const loader = vi.fn<PanelLoader>(() => Promise.reject(failure()));
    render(<ChatBubble panelLoader={loader} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(loader).not.toHaveBeenCalled(); // nothing is fetched until the delayed prefetch or a click (see ChatBubble.prefetch.test)
  });

  it('hides the notice when the chat is closed, and the close button dismisses it', async () => {
    const user = userEvent.setup();
    render(<ChatBubble panelLoader={() => Promise.reject(failure())} />);
    await user.click(bubble());
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Close chat' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(bubble()).toHaveAttribute('aria-expanded', 'false');
    expect(bubble()).toHaveFocus();
  });

  it('closes the notice with Escape', async () => {
    const user = userEvent.setup();
    render(<ChatBubble panelLoader={() => Promise.reject(failure())} />);
    await user.click(bubble());
    await screen.findByRole('alert');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Try again imports the panel again, and the real panel then appears', async () => {
    const user = userEvent.setup();
    const loader = vi
      .fn<PanelLoader>()
      .mockRejectedValueOnce(failure())
      .mockResolvedValueOnce({ default: FakePanel });
    render(<ChatBubble panelLoader={loader} />);
    await user.click(bubble());
    await screen.findByRole('alert');
    expect(loader).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('dialog', { name: 'Fake panel' })).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(2); // a second import, not React.lazy's cached rejection
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the notice again if the retry fails too', async () => {
    const user = userEvent.setup();
    const loader = vi.fn<PanelLoader>(() => Promise.reject(failure()));
    render(<ChatBubble panelLoader={loader} />);
    await user.click(bubble());
    await screen.findByRole('alert');
    expect(loader).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something hiccuped on our end.');
  });

  it('opening the chat again after a failure retries on its own', async () => {
    const user = userEvent.setup();
    const loader = vi
      .fn<PanelLoader>()
      .mockRejectedValueOnce(failure())
      .mockResolvedValue({ default: FakePanel });
    render(<ChatBubble panelLoader={loader} />);
    await user.click(bubble());
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Close chat' }));

    await user.click(bubble());
    expect(await screen.findByRole('dialog', { name: 'Fake panel' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
