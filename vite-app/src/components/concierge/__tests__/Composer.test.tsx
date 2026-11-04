import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Composer from '../Composer';
import { TOO_LONG } from '../copy';

type Props = Parameters<typeof Composer>[0];

const setup = (props: Partial<Props> = {}) => {
  const onSend = vi.fn();
  const onEdit = vi.fn();
  const user = userEvent.setup();
  render(
    <Composer
      onSend={onSend}
      onEdit={onEdit}
      busy={false}
      disabled={false}
      error={null}
      {...props}
    />
  );
  return { onSend, onEdit, user, box: screen.getByRole('textbox', { name: 'Message' }) };
};

describe('Composer', () => {
  it('sends on Enter and clears the box', async () => {
    const { onSend, user, box } = setup();
    await user.type(box, 'How much is it?{Enter}');
    expect(onSend).toHaveBeenCalledWith('How much is it?');
    expect(box).toHaveValue('');
  });

  it('inserts a newline on Shift+Enter instead of sending', async () => {
    const { onSend, user, box } = setup();
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue('line one\nline two');
  });

  it('sends with the button', async () => {
    const { onSend, user, box } = setup();
    await user.type(box, 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend).toHaveBeenCalledWith('Hello');
  });

  it('does not send an empty or whitespace-only message', async () => {
    const { onSend, user, box } = setup();
    await user.type(box, '   {Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('shows a 1,000-character counter once there is text', async () => {
    const { user, box } = setup();
    expect(screen.queryByText(/\/ 1,000/)).not.toBeInTheDocument();
    await user.type(box, 'Hi there');
    expect(screen.getByText('8 / 1,000')).toBeInTheDocument();
  });

  it('flags a message over 1,000 characters, blocks sending and explains', async () => {
    const { onSend, user, box } = setup();
    await user.click(box);
    await user.paste('x'.repeat(1001));
    expect(screen.getByText('1,001 / 1,000')).toBeInTheDocument();
    expect(screen.getByText(TOO_LONG)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('allows exactly 1,000 characters', async () => {
    const { onSend, user, box } = setup();
    await user.click(box);
    await user.paste('x'.repeat(1000));
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('does not send while a reply is pending but keeps the text', async () => {
    const { onSend, user, box } = setup({ busy: true });
    await user.type(box, 'Another one{Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue('Another one');
  });

  it('shows an error passed from the state machine', () => {
    setup({ error: TOO_LONG });
    expect(screen.getByRole('alert')).toHaveTextContent(TOO_LONG);
  });

  it('keeps one empty alert container in the page so a later error is announced', () => {
    const { rerender } = render(
      <Composer onSend={() => {}} busy={false} disabled={false} error={null} />
    );
    const container = screen.getByRole('alert');
    expect(container).toBeEmptyDOMElement();

    rerender(<Composer onSend={() => {}} busy={false} disabled={false} error={TOO_LONG} />);
    // The same element, now filled: assistive tech announces text added to an existing alert.
    expect(screen.getByRole('alert')).toBe(container);
    expect(container).toHaveTextContent(TOO_LONG);
  });

  it('only points the textarea at the alert while it has something to say', () => {
    const { rerender } = render(
      <Composer onSend={() => {}} busy={false} disabled={false} error={null} />
    );
    expect(screen.getByRole('textbox', { name: 'Message' })).not.toHaveAttribute('aria-describedby');
    rerender(<Composer onSend={() => {}} busy={false} disabled={false} error={TOO_LONG} />);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAccessibleDescription(TOO_LONG);
  });

  it('tells the parent when the visitor edits so it can clear errors', async () => {
    const { onEdit, user, box } = setup({ error: TOO_LONG });
    await user.type(box, 'a');
    expect(onEdit).toHaveBeenCalled();
  });

  it('is fully disabled when the chat has ended', () => {
    setup({ disabled: true });
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });
});
