import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../lib/track', () => ({ track: vi.fn() }));

import LeadForm from '../LeadForm';
import { track } from '../../../lib/track';
import type { SubmitLeadOutcome } from '../useConcierge';
import { EMPTY_LEAD_DRAFT } from '../leadDraft';
import type { LeadDraft } from '../types';
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

  describe('pre-filled from the conversation (plan v1.1)', () => {
    const prefill: LeadDraft = {
      name: 'Dana Lee',
      phone: '7705550147',
      email: 'dana@example.com',
      business: 'Lee Landscaping',
      need: 'missed after-hours calls',
      callbackWindow: 'afternoon_1_3',
    };

    it('starts with all six fields filled from the draft', () => {
      setup({ prefill });
      expect(screen.getByLabelText('Name')).toHaveValue('Dana Lee');
      expect(screen.getByLabelText('Phone')).toHaveValue('(770) 555-0147');
      expect(screen.getByLabelText('Email (optional)')).toHaveValue('dana@example.com');
      expect(screen.getByLabelText('Business name')).toHaveValue('Lee Landscaping');
      expect(screen.getByLabelText('What do you need help with? (optional)')).toHaveValue(
        'missed after-hours calls'
      );
      expect(screen.getByLabelText('Best callback window')).toHaveValue('afternoon_1_3');
    });

    it('never pre-checks consent, however complete the draft is', () => {
      setup({ prefill });
      expect(screen.getByLabelText(copy.CONSENT)).not.toBeChecked();
    });

    it('will not send until the visitor ticks the consent box themselves', async () => {
      const { onSubmit, user } = setup({ prefill });
      await submit(user);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByText('Check this box so we can contact you')).toBeInTheDocument();
    });

    it('is ready to send after one tick: submits the pre-filled details, normalized', async () => {
      const { onSubmit, user } = setup({ prefill });
      await user.click(screen.getByLabelText(copy.CONSENT));
      await submit(user);
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Dana Lee',
        phone: '7705550147',
        email: 'dana@example.com',
        business: 'Lee Landscaping',
        need: 'missed after-hours calls',
        callbackWindow: 'afternoon_1_3',
        consent: true,
      });
    });

    it('lets the visitor edit anything before sending', async () => {
      const { onSubmit, user } = setup({ prefill });
      const name = screen.getByLabelText('Name');
      await user.clear(name);
      await user.type(name, 'Dana L. Lee');
      await user.selectOptions(screen.getByLabelText('Best callback window'), 'morning_9_11');
      await user.click(screen.getByLabelText(copy.CONSENT));
      await submit(user);
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Dana L. Lee', callbackWindow: 'morning_9_11' })
      );
    });

    it('still validates a pre-filled value that is wrong', async () => {
      const { onSubmit, user } = setup({ prefill: { ...prefill, phone: '12345' } });
      await user.click(screen.getByLabelText(copy.CONSENT));
      await submit(user);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByText('Enter a 10-digit US phone number')).toBeInTheDocument();
    });

    it('shows a partly filled draft as partly filled (what the helper did not gather stays blank)', () => {
      setup({ prefill: { ...EMPTY_LEAD_DRAFT, name: 'Dana Lee' } });
      expect(screen.getByLabelText('Name')).toHaveValue('Dana Lee');
      expect(screen.getByLabelText('Phone')).toHaveValue('');
      expect(screen.getByLabelText('Best callback window')).toHaveValue('');
    });

    it('only uses the draft for the first render: later changes do not overwrite what was typed', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      const { rerender } = render(
        <LeadForm onSubmit={onSubmit} sending={false} deliveryFailed={false} prefill={prefill} />
      );
      await user.type(screen.getByLabelText('Name'), ' Jr');
      rerender(
        <LeadForm
          onSubmit={onSubmit}
          sending={false}
          deliveryFailed={false}
          prefill={{ ...prefill, name: 'Someone Else' }}
        />
      );
      expect(screen.getByLabelText('Name')).toHaveValue('Dana Lee Jr');
    });

    it('shows the heading above the fields and announces it with the form', () => {
      setup({ prefill, heading: copy.LEAD_FORM_HEADING });
      const heading = screen.getByText("Here's what I have. Check the box and tap send.");
      const form = screen.getByRole('form', { name: 'Callback request' });
      expect(form).toHaveAccessibleDescription("Here's what I have. Check the box and tap send.");
      expect(heading.compareDocumentPosition(screen.getByLabelText('Name'))).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      );
    });

    it('shows a pre-filled phone as (770) 555-0147 and still submits 10 digits', async () => {
      const { onSubmit, user } = setup({ prefill });
      expect(screen.getByLabelText('Phone')).toHaveValue('(770) 555-0147');
      await user.click(screen.getByLabelText(copy.CONSENT));
      await submit(user);
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ phone: '7705550147' }));
    });

    it('leaves a phone that is not exactly 10 digits as given (so the visitor can fix it)', () => {
      setup({ prefill: { ...prefill, phone: '77055' } });
      expect(screen.getByLabelText('Phone')).toHaveValue('77055');
    });

    describe('consent box description', () => {
      it('includes the heading when the consent box is where focus goes', () => {
        setup({ prefill, heading: copy.LEAD_FORM_HEADING });
        const consent = screen.getByLabelText(copy.CONSENT);
        expect(consent).toHaveFocus();
        expect(consent).toHaveAccessibleDescription("Here's what I have. Check the box and tap send.");
      });

      it('does not, when focus goes to some other field', () => {
        setup({ prefill: { ...prefill, phone: '' }, heading: copy.LEAD_FORM_HEADING });
        expect(screen.getByLabelText('Phone')).toHaveFocus();
        expect(screen.getByLabelText(copy.CONSENT)).not.toHaveAttribute('aria-describedby');
      });

      it('does not without a heading', () => {
        setup({ prefill });
        expect(screen.getByLabelText(copy.CONSENT)).not.toHaveAttribute('aria-describedby');
      });

      it('keeps the consent error in the description too, alongside the heading', async () => {
        const { user } = setup({ prefill, heading: copy.LEAD_FORM_HEADING });
        await submit(user); // box not ticked
        const consent = screen.getByLabelText(copy.CONSENT);
        expect(consent).toHaveAccessibleDescription(
          expect.stringContaining('Check this box so we can contact you')
        );
        expect(consent).toHaveAccessibleDescription(
          expect.stringContaining("Here's what I have. Check the box and tap send.")
        );
      });
    });

    it('has no heading when none is given', () => {
      setup({ prefill });
      expect(screen.queryByText("Here's what I have. Check the box and tap send.")).not.toBeInTheDocument();
      expect(screen.getByRole('form', { name: 'Callback request' })).not.toHaveAttribute('aria-describedby');
    });

    it('focuses the consent box when name, phone and business are all pre-filled', () => {
      setup({ prefill, heading: copy.LEAD_FORM_HEADING });
      expect(screen.getByLabelText(copy.CONSENT)).toHaveFocus();
    });

    it('focuses the first required field that is still empty', () => {
      const base = { ...EMPTY_LEAD_DRAFT };
      const cases: Array<[Partial<LeadDraft>, string]> = [
        [{ name: 'Dana Lee' }, 'Phone'],
        [{ name: 'Dana Lee', phone: '7705550147' }, 'Business name'],
        [{ phone: '7705550147', business: 'Lee Landscaping' }, 'Name'],
        [{ name: 'Dana Lee', business: 'Lee Landscaping' }, 'Phone'],
        // name, phone and business in, but no callback window yet: the select is next
        [{ name: 'Dana Lee', phone: '7705550147', business: 'Lee Landscaping' }, 'Best callback window'],
      ];
      for (const [partial, label] of cases) {
        const { unmount } = render(
          <LeadForm onSubmit={vi.fn()} sending={false} deliveryFailed={false} prefill={{ ...base, ...partial }} />
        );
        expect(screen.getByLabelText(label), JSON.stringify(partial)).toHaveFocus();
        unmount();
      }
    });

    it('an optional field that is filled does not count: email and need alone leave the first field focused', () => {
      setup({ prefill: { ...EMPTY_LEAD_DRAFT, email: 'dana@example.com', need: 'calls' } });
      expect(screen.getByLabelText('Name')).toHaveFocus();
    });

    it('treats a whitespace-only value as empty', () => {
      setup({ prefill: { ...prefill, phone: '   ' } });
      expect(screen.getByLabelText('Phone')).toHaveFocus();
    });

    it('keeps today\'s behaviour for a form with no draft: the first field', () => {
      setup();
      expect(screen.getByLabelText('Name')).toHaveFocus();
    });

    describe('revealing the focus target (a pre-filled form is taller than the chat area)', () => {
      const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
      const spy = vi.fn();
      beforeEach(() => {
        spy.mockClear();
        Element.prototype.scrollIntoView = spy;
      });
      afterEach(() => {
        if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
        else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
      });

      it('brings the end of the form into view when the consent box is the target, so consent, send and "not now" are all visible', async () => {
        const onDismiss = vi.fn();
        render(
          <LeadForm onSubmit={vi.fn()} sending={false} deliveryFailed={false} prefill={prefill} onDismiss={onDismiss} />
        );
        await vi.waitFor(() => expect(spy).toHaveBeenCalled());
        const form = screen.getByRole('form', { name: 'Callback request' });
        expect(spy.mock.contexts[0]).toBe(form.lastElementChild);
        expect(spy.mock.contexts[0]).toBe(screen.getByRole('button', { name: copy.LEAD_FORM_DISMISS }));
        expect(spy).toHaveBeenCalledWith({ block: 'nearest' });
      });

      it('without a dismiss button the end of the form is the send button', async () => {
        setup({ prefill });
        await vi.waitFor(() => expect(spy).toHaveBeenCalled());
        expect(spy.mock.contexts[0]).toBe(screen.getByRole('button', { name: 'Request my callback' }));
      });

      it('brings a later required field itself into view', async () => {
        setup({ prefill: { ...EMPTY_LEAD_DRAFT, name: 'Dana Lee' } });
        await vi.waitFor(() => expect(spy).toHaveBeenCalled());
        expect(spy.mock.contexts[0]).toBe(screen.getByLabelText('Phone'));
      });

      it('does nothing extra when the first field is the target: no frame is even requested', () => {
        const raf = vi.spyOn(window, 'requestAnimationFrame');
        try {
          setup();
          expect(screen.getByLabelText('Name')).toHaveFocus();
          expect(raf).not.toHaveBeenCalled(); // the scroll is scheduled with a frame, so none means none
          expect(spy).not.toHaveBeenCalled();
        } finally {
          raf.mockRestore();
        }
      });

      it('brings the select into view when the window is the first thing missing', async () => {
        setup({ prefill: { ...prefill, callbackWindow: '' } });
        await vi.waitFor(() => expect(spy).toHaveBeenCalled());
        expect(spy.mock.contexts[0]).toBe(screen.getByLabelText('Best callback window'));
      });
    });
  });

  describe('"Not now, keep chatting"', () => {
    it('renders under the submit button when a dismiss handler is given, and calls it', async () => {
      const onDismiss = vi.fn();
      const user = userEvent.setup();
      render(<LeadForm onSubmit={vi.fn()} sending={false} deliveryFailed={false} onDismiss={onDismiss} />);
      const submitButton = screen.getByRole('button', { name: 'Request my callback' });
      const dismiss = screen.getByRole('button', { name: copy.LEAD_FORM_DISMISS });
      expect(dismiss).toHaveAttribute('type', 'button');
      expect(submitButton.compareDocumentPosition(dismiss)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      await user.click(dismiss);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('is not rendered without a handler (lead-only mode)', () => {
      render(<LeadForm onSubmit={vi.fn()} sending={false} deliveryFailed={false} />);
      expect(screen.queryByRole('button', { name: copy.LEAD_FORM_DISMISS })).not.toBeInTheDocument();
    });

    it('does not submit the form or validate anything when clicked', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      render(<LeadForm onSubmit={onSubmit} sending={false} deliveryFailed={false} onDismiss={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: copy.LEAD_FORM_DISMISS }));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.queryByText('Enter your name')).not.toBeInTheDocument();
    });

    it('is disabled while a send is in flight, so the form cannot vanish under it', async () => {
      const onDismiss = vi.fn();
      const user = userEvent.setup();
      render(<LeadForm onSubmit={vi.fn()} sending deliveryFailed={false} onDismiss={onDismiss} />);
      const dismiss = screen.getByRole('button', { name: copy.LEAD_FORM_DISMISS });
      expect(dismiss).toBeDisabled();
      await user.click(dismiss);
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('hands over what the visitor has typed, cleaned like a model draft', async () => {
      const onDismiss = vi.fn();
      const user = userEvent.setup();
      render(
        <LeadForm
          onSubmit={vi.fn()}
          sending={false}
          deliveryFailed={false}
          onDismiss={onDismiss}
          prefill={{ ...EMPTY_LEAD_DRAFT, name: 'Dana Lee', phone: '7705550147' }}
        />
      );
      const business = screen.getByLabelText('Business name');
      await user.type(business, '  Lee Lawn and Garden ');
      await user.type(screen.getByLabelText('Email (optional)'), 'dana@example.com');
      await user.type(screen.getByLabelText('What do you need help with? (optional)'), 'fewer missed calls');
      await user.selectOptions(screen.getByLabelText('Best callback window'), 'morning_9_11');
      await user.click(screen.getByLabelText(copy.CONSENT)); // consent is not part of a draft
      await user.click(screen.getByRole('button', { name: copy.LEAD_FORM_DISMISS }));
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(onDismiss).toHaveBeenCalledWith({
        name: 'Dana Lee',
        phone: '7705550147', // the shown "(770) 555-0147" goes back to 10 digits
        email: 'dana@example.com',
        business: 'Lee Lawn and Garden',
        need: 'fewer missed calls',
        callbackWindow: 'morning_9_11',
      });
    });

    it('drops what is not usable yet: a half-typed phone, a half-typed email', async () => {
      const onDismiss = vi.fn();
      const user = userEvent.setup();
      render(<LeadForm onSubmit={vi.fn()} sending={false} deliveryFailed={false} onDismiss={onDismiss} />);
      await user.type(screen.getByLabelText('Name'), 'Dana Lee');
      await user.type(screen.getByLabelText('Phone'), '770555');
      await user.type(screen.getByLabelText('Email (optional)'), 'dana@exa');
      await user.click(screen.getByRole('button', { name: copy.LEAD_FORM_DISMISS }));
      expect(onDismiss).toHaveBeenCalledWith({ ...EMPTY_LEAD_DRAFT, name: 'Dana Lee' });
    });

    it('fires no analytics event', async () => {
      const user = userEvent.setup();
      render(<LeadForm onSubmit={vi.fn()} sending={false} deliveryFailed={false} onDismiss={vi.fn()} />);
      vi.mocked(track).mockClear();
      await user.click(screen.getByRole('button', { name: copy.LEAD_FORM_DISMISS }));
      expect(track).not.toHaveBeenCalled();
    });
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
