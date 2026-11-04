import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../lib/track', () => ({ track: vi.fn() }));

import LeadForm from '../LeadForm';
import { track } from '../../../lib/track';
import type { SubmitLeadOutcome } from '../useConcierge';
import * as copy from '../copy';

type Props = Parameters<typeof LeadForm>[0];

const setup = (props: Partial<Props> = {}) => {
  const onSubmit = vi.fn<Props['onSubmit']>().mockResolvedValue({ ok: true });
  const user = userEvent.setup();
  render(<LeadForm onSubmit={onSubmit} sending={false} deliveryFailed={false} {...props} />);
  return { onSubmit, user };
};

type User = ReturnType<typeof userEvent.setup>;

const fillValid = async (user: User) => {
  await user.type(screen.getByLabelText('Name'), 'Jane Doe');
  await user.type(screen.getByLabelText('Phone'), '(770) 555-1234');
  await user.type(screen.getByLabelText('Business name'), 'Doe Plumbing');
  await user.selectOptions(screen.getByLabelText('Best callback window'), 'afternoon_1_3');
  await user.click(screen.getByLabelText(copy.CONSENT));
};

const submit = (user: User) =>
  user.click(screen.getByRole('button', { name: /request my callback/i }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LeadForm', () => {
  it('offers the four callback windows with their labels', () => {
    setup();
    const select = screen.getByLabelText('Best callback window');
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toEqual([
      'Choose a time…',
      'Weekday morning (9–11 AM ET)',
      'Midday (11 AM–1 PM ET)',
      'Afternoon (1–3 PM ET)',
      'Late afternoon (3–5 PM ET)',
    ]);
  });

  it('shows inline errors and does not submit when everything is empty', async () => {
    const { onSubmit, user } = setup();
    await submit(user);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Enter your name')).toBeInTheDocument();
    expect(screen.getByText('Enter a 10-digit US phone number')).toBeInTheDocument();
    expect(screen.getByText('Enter your business name')).toBeInTheDocument();
    expect(screen.getByText('Pick a callback window')).toBeInTheDocument();
    expect(screen.getByText('Check this box so we can contact you')).toBeInTheDocument();
    // Focus lands on the first invalid field.
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('rejects a bad phone number without submitting', async () => {
    const { onSubmit, user } = setup();
    await fillValid(user);
    const phone = screen.getByLabelText('Phone');
    await user.clear(phone);
    await user.type(phone, '770555123');
    await submit(user);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a 10-digit US phone number')).toBeInTheDocument();
    expect(phone).toHaveAttribute('aria-invalid', 'true');
    expect(phone).toHaveAccessibleDescription('Enter a 10-digit US phone number');
  });

  it('rejects a bad email without submitting', async () => {
    const { onSubmit, user } = setup();
    await fillValid(user);
    await user.type(screen.getByLabelText('Email (optional)'), 'not-an-email');
    await submit(user);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
  });

  it('rejects a missing consent without submitting', async () => {
    const { onSubmit, user } = setup();
    await fillValid(user);
    await user.click(screen.getByLabelText(copy.CONSENT)); // uncheck
    await submit(user);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Check this box so we can contact you')).toBeInTheDocument();
  });

  it('clears a field error as soon as the visitor edits that field', async () => {
    const { user } = setup();
    await submit(user);
    expect(screen.getByText('Enter your name')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'J');
    expect(screen.queryByText('Enter your name')).not.toBeInTheDocument();
  });

  it('submits the normalized payload for a valid form', async () => {
    const { onSubmit, user } = setup();
    await fillValid(user);
    await submit(user);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Jane Doe',
      phone: '7705551234',
      business: 'Doe Plumbing',
      callbackWindow: 'afternoon_1_3',
      consent: true,
    });
  });

  it('includes optional email and need when given', async () => {
    const { onSubmit, user } = setup();
    await fillValid(user);
    await user.type(screen.getByLabelText('Email (optional)'), 'jane@example.com');
    await user.type(
      screen.getByLabelText('What do you need help with? (optional)'),
      'Missed calls after hours'
    );
    await submit(user);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'jane@example.com',
        need: 'Missed calls after hours',
      })
    );
  });

  it('maps server field errors onto the inline messages and keeps the values', async () => {
    const outcome: SubmitLeadOutcome = {
      ok: false,
      fields: { phone: 'Enter a 10-digit US phone number' },
    };
    const { onSubmit, user } = setup();
    onSubmit.mockResolvedValue(outcome);
    await fillValid(user);
    await submit(user);
    expect(await screen.findByText('Enter a 10-digit US phone number')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Jane Doe');
    expect(screen.getByLabelText('Phone')).toHaveValue('(770) 555-1234');
  });

  it('keeps the form filled after a delivery failure', async () => {
    const { onSubmit, user } = setup();
    onSubmit.mockResolvedValue({ ok: false });
    await fillValid(user);
    await submit(user);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Business name')).toHaveValue('Doe Plumbing');
    expect(screen.getByLabelText(copy.CONSENT)).toBeChecked();
  });

  it('shows the delivery-failed notice with a tap-to-call link above the form', () => {
    setup({ deliveryFailed: true });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("I couldn't send that just now.");
    const link = screen.getByRole('link', { name: '(866) 519-7993' });
    expect(link).toHaveAttribute('href', 'tel:+18665197993');
    expect(alert.compareDocumentPosition(screen.getByLabelText('Name'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  describe('delivery failure feedback', () => {
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    const scrollIntoView = vi.fn();

    beforeEach(() => {
      scrollIntoView.mockClear();
      Element.prototype.scrollIntoView = scrollIntoView;
    });

    afterEach(() => {
      if (originalScrollIntoView) {
        Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
      } else {
        delete (Element.prototype as Partial<Element>).scrollIntoView;
      }
    });

    it('moves focus to the notice and scrolls it into view when a failure appears', () => {
      const onSubmit = vi.fn();
      const { rerender } = render(
        <LeadForm onSubmit={onSubmit} sending={false} deliveryFailed={false} />
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      rerender(<LeadForm onSubmit={onSubmit} sending={false} deliveryFailed />);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveFocus();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(alert);
    });

    it('does it again on a second failure after the notice was cleared for the retry', () => {
      const onSubmit = vi.fn();
      const { rerender } = render(<LeadForm onSubmit={onSubmit} sending={false} deliveryFailed />);
      rerender(<LeadForm onSubmit={onSubmit} sending deliveryFailed={false} />);
      screen.getByLabelText('Name').focus();
      rerender(<LeadForm onSubmit={onSubmit} sending={false} deliveryFailed />);
      expect(screen.getByRole('alert')).toHaveFocus();
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
    });

    it('focuses the notice rather than the first field when the form mounts already failed', () => {
      render(<LeadForm onSubmit={vi.fn()} sending={false} deliveryFailed />);
      expect(screen.getByRole('alert')).toHaveFocus();
    });

    it('shows the delivery-failed text by default and a server message when given one', () => {
      const onSubmit = vi.fn();
      const { rerender } = render(<LeadForm onSubmit={onSubmit} sending={false} deliveryFailed />);
      expect(screen.getByRole('alert')).toHaveTextContent("I couldn't send that just now.");

      rerender(
        <LeadForm onSubmit={onSubmit} sending={false} deliveryFailed failureMessage="Invalid session id" />
      );
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Invalid session id');
      expect(alert).not.toHaveTextContent("I couldn't send that just now.");
    });

    it('still offers the phone number when it shows a server message', () => {
      render(
        <LeadForm onSubmit={vi.fn()} sending={false} deliveryFailed failureMessage="Invalid session id" />
      );
      expect(screen.getByRole('link', { name: '(866) 519-7993' })).toHaveAttribute('href', 'tel:+18665197993');
    });
  });

  it('does not take focus from a field outside the form when it appears', () => {
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    render(<LeadForm onSubmit={vi.fn()} sending={false} deliveryFailed={false} />);
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it('tracks a tap on the phone link as a panel call click', async () => {
    const { user } = setup({ deliveryFailed: true });
    await user.click(screen.getByRole('link', { name: '(866) 519-7993' }));
    expect(track).toHaveBeenCalledWith('concierge_call_click', { location: 'panel' });
  });

  it('disables the submit button while sending', () => {
    setup({ sending: true });
    expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled();
  });

  it('has no required-field HTML validation that would block our own messages', () => {
    setup();
    expect(screen.getByRole('button', { name: /request my callback/i }).closest('form')).toHaveAttribute(
      'novalidate'
    );
  });
});
