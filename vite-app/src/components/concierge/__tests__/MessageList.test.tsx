import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../lib/track', () => ({ track: vi.fn() }));

import MessageList from '../MessageList';
import { track } from '../../../lib/track';
import type { Message } from '../types';

const msg = (over: Partial<Message> & Pick<Message, 'role' | 'content'>): Message => ({
  id: `${over.role}-${over.content}`,
  at: '2026-11-03T15:00:00.000Z',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MessageList', () => {
  it('is a polite live log inside a Lenis-protected scroll container', () => {
    const { container } = render(
      <MessageList messages={[msg({ role: 'assistant', content: 'Hello' })]} typing={false} formVisible={false} />
    );
    const log = screen.getByRole('log', { name: 'Conversation' });
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(container.querySelector('[data-lenis-prevent]')).not.toBeNull();
    expect(container.querySelector('[data-lenis-prevent]')?.contains(log)).toBe(true);
  });

  it('marks the visitor\'s own rows so they are not announced back to them', () => {
    render(
      <MessageList
        messages={[
          msg({ role: 'assistant', content: 'Hi there' }),
          msg({ role: 'user', content: 'What do you do?' }),
        ]}
        typing={false}
        formVisible={false}
      />
    );
    const [assistantRow, userRow] = screen.getAllByRole('listitem');
    expect(userRow).toHaveAttribute('aria-live', 'off');
    expect(assistantRow).not.toHaveAttribute('aria-live');
  });

  it('renders messages in order and labels the speaker for screen readers', () => {
    render(
      <MessageList
        messages={[
          msg({ role: 'assistant', content: 'Hi there' }),
          msg({ role: 'user', content: 'What do you do?' }),
        ]}
        typing={false}
        formVisible={false}
      />
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('THG helper: Hi there');
    expect(items[1]).toHaveTextContent('You: What do you do?');
    expect(screen.getByText('What do you do?')).toBeInTheDocument();
  });

  it('turns the phone number in a message into a tap-to-call link and tracks taps', async () => {
    const user = userEvent.setup();
    render(
      <MessageList
        messages={[
          msg({ role: 'assistant', content: 'You can try again, or call (866) 519-7993.' }),
        ]}
        typing={false}
        formVisible={false}
      />
    );
    const link = screen.getByRole('link', { name: '(866) 519-7993' });
    expect(link).toHaveAttribute('href', 'tel:+18665197993');
    await user.click(link);
    expect(track).toHaveBeenCalledWith('concierge_call_click', { location: 'panel' });
  });

  it('adds a call link to a handoff message that does not mention the number', () => {
    render(
      <MessageList
        messages={[msg({ role: 'assistant', content: 'Sure, a person can help.', callLink: true })]}
        typing={false}
        formVisible={false}
      />
    );
    expect(screen.getByRole('link', { name: /call \(866\) 519-7993/i })).toHaveAttribute(
      'href',
      'tel:+18665197993'
    );
  });

  it('does not duplicate the link when a handoff message already has the number', () => {
    render(
      <MessageList
        messages={[
          msg({
            role: 'assistant',
            content: 'You got it — call (866) 519-7993 to reach a person on our team.',
            callLink: true,
          }),
        ]}
        typing={false}
        formVisible={false}
      />
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('never turns visitor text into a link', () => {
    render(
      <MessageList
        messages={[msg({ role: 'user', content: 'my number is (866) 519-7993' })]}
        typing={false}
        formVisible={false}
      />
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows a typing indicator that screen readers hear', () => {
    render(<MessageList messages={[]} typing formVisible={false} />);
    expect(screen.getByText('THG helper is typing')).toBeInTheDocument();
  });

  it('renders children (chips, lead form) after the log, inside the scroller', () => {
    const { container } = render(
      <MessageList messages={[]} typing={false} formVisible>
        <div data-cc-form data-testid="form">form</div>
      </MessageList>
    );
    const scroller = container.querySelector('[data-lenis-prevent]');
    expect(scroller?.contains(screen.getByTestId('form'))).toBe(true);
    expect(screen.getByRole('log').contains(screen.getByTestId('form'))).toBe(false);
  });
});

describe('MessageList scrolling', () => {
  const scrollTo = vi.fn();
  const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
  const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');

  beforeEach(() => {
    scrollTo.mockClear();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 900 });
  });

  afterEach(() => {
    if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
    if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
  });

  const thread = [
    msg({ role: 'assistant', content: 'Hi there' }),
    msg({ role: 'user', content: 'What do you do?' }),
    msg({ role: 'assistant', content: 'We help.' }),
  ];

  it('scrolls to the newest message when one arrives', () => {
    const { rerender } = render(<MessageList messages={thread.slice(0, 2)} typing={false} formVisible={false} />);
    scrollTo.mockClear();
    rerender(<MessageList messages={thread} typing={false} formVisible={false} />);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 900 }));
  });

  it('scrolls to the newest message again when the panel is reopened', () => {
    const { rerender } = render(<MessageList messages={thread} typing={false} formVisible={false} open />);
    rerender(<MessageList messages={thread} typing={false} formVisible={false} open={false} />);
    scrollTo.mockClear();

    rerender(<MessageList messages={thread} typing={false} formVisible={false} open />);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    // Instant, not an animation from the top of a list that was hidden.
    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'auto' });
  });

  it('does not scroll while the panel is closed', () => {
    const { rerender } = render(<MessageList messages={thread.slice(0, 2)} typing={false} formVisible={false} open={false} />);
    scrollTo.mockClear();
    rerender(<MessageList messages={thread} typing={false} formVisible={false} open={false} />);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
