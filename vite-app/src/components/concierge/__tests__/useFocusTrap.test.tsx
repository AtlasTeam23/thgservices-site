import { describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFocusTrap } from '../useFocusTrap';

function Harness({
  active,
  onEscape,
  withInitial = false,
  disabledInitial = false,
}: {
  active: boolean;
  onEscape: () => void;
  withInitial?: boolean;
  disabledInitial?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<HTMLButtonElement>(null);
  const secondRef = useRef<HTMLButtonElement>(null);
  const disabledRef = useRef<HTMLTextAreaElement>(null);
  useFocusTrap(containerRef, {
    active,
    onEscape,
    returnFocusRef: returnRef,
    getInitialFocus: disabledInitial
      ? () => disabledRef.current
      : withInitial
        ? () => secondRef.current
        : undefined,
  });
  return (
    <>
      <button ref={returnRef}>bubble</button>
      <div ref={containerRef} tabIndex={-1} data-testid="panel">
        <button>first</button>
        <button ref={secondRef}>second</button>
        <button disabled>disabled</button>
        <textarea disabled aria-label="ended composer" ref={disabledRef} />
        <div hidden>
          <button>hidden</button>
        </div>
        <a href="tel:+18665197993">last</a>
      </div>
      <button>outside</button>
    </>
  );
}

describe('useFocusTrap', () => {
  it('moves focus to the first focusable element when activated', () => {
    render(<Harness active onEscape={() => {}} />);
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus();
  });

  it('uses getInitialFocus when it returns an element', () => {
    render(<Harness active onEscape={() => {}} withInitial />);
    expect(screen.getByRole('button', { name: 'second' })).toHaveFocus();
  });

  it('skips a disabled preferred element and falls back to the first focusable one', () => {
    render(<Harness active onEscape={() => {}} disabledInitial />);
    expect(screen.getByRole('textbox', { name: 'ended composer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus();
  });

  it('skips a preferred element marked aria-disabled too', () => {
    function AriaDisabled() {
      const containerRef = useRef<HTMLDivElement>(null);
      const target = useRef<HTMLButtonElement>(null);
      useFocusTrap(containerRef, { active: true, onEscape: () => {}, getInitialFocus: () => target.current });
      return (
        <div ref={containerRef}>
          <button>one</button>
          <button ref={target} aria-disabled="true">
            two
          </button>
        </div>
      );
    }
    render(<AriaDisabled />);
    expect(screen.getByRole('button', { name: 'one' })).toHaveFocus();
  });

  it('keeps Tab inside the container and wraps in both directions', async () => {
    const user = userEvent.setup();
    render(<Harness active onEscape={() => {}} />);
    const first = screen.getByRole('button', { name: 'first' });
    const second = screen.getByRole('button', { name: 'second' });
    const last = screen.getByRole('link', { name: 'last' });

    expect(first).toHaveFocus();
    await user.tab();
    expect(second).toHaveFocus();
    await user.tab(); // skips the disabled and hidden buttons
    expect(last).toHaveFocus();
    await user.tab(); // wraps to the start, never reaches "outside"
    expect(first).toHaveFocus();
    await user.tab({ shift: true }); // wraps backwards to the end
    expect(last).toHaveFocus();
  });

  it('pulls focus back in if it was somewhere outside', async () => {
    const user = userEvent.setup();
    render(<Harness active onEscape={() => {}} />);
    screen.getByRole('button', { name: 'outside' }).focus();
    await user.tab();
    expect(screen.getByTestId('panel').contains(document.activeElement)).toBe(true);
  });

  it('calls onEscape when Esc is pressed', async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    render(<Harness active onEscape={onEscape} />);
    await user.keyboard('{Escape}');
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('does nothing while inactive', async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    render(<Harness active={false} onEscape={onEscape} />);
    expect(screen.getByRole('button', { name: 'first' })).not.toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('restores focus to the return element when deactivated', () => {
    const { rerender } = render(<Harness active onEscape={() => {}} />);
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus();
    rerender(<Harness active={false} onEscape={() => {}} />);
    expect(screen.getByRole('button', { name: 'bubble' })).toHaveFocus();
  });
});
