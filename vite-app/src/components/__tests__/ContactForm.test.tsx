import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/analytics', () => ({ trackEvent: vi.fn() }));

import ContactForm from '../ContactForm';
import { trackEvent } from '../../lib/analytics';

const TYPED = {
  name: 'Jane Q Tester',
  email: 'jane.tester@example.com',
  phone: '+15555550142',
  message: 'Please call me about the roof estimate',
};

async function fillAndSend(user: ReturnType<typeof userEvent.setup>, answer = '2') {
  await user.type(screen.getByLabelText('Name'), TYPED.name);
  await user.type(screen.getByLabelText('Email'), TYPED.email);
  await user.type(screen.getByLabelText(/Phone/), TYPED.phone);
  await user.type(screen.getByLabelText('Message'), TYPED.message);
  await user.type(screen.getByLabelText(/Quick check/), answer);
  await user.click(screen.getByRole('button', { name: 'Send Message' }));
}

describe('ContactForm analytics', () => {
  beforeEach(() => {
    vi.mocked(trackEvent).mockClear();
    // a = 1, b = 1, so the quick check is 1 + 1 = 2.
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends generate_lead with only form_id when the message is accepted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ json: async () => ({ success: true }) })
    );
    const user = userEvent.setup();
    render(<ContactForm />);
    await fillAndSend(user);

    expect(await screen.findByRole('status')).toHaveTextContent('your message is on its way');
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith('generate_lead', { form_id: 'contact' });
  });

  it('carries no form values into the event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ json: async () => ({ success: true }) })
    );
    const user = userEvent.setup();
    render(<ContactForm />);
    await fillAndSend(user);
    await screen.findByRole('status');

    // Exactly one call, so the scan below is not passing on an empty list.
    expect(trackEvent).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(vi.mocked(trackEvent).mock.calls);
    for (const value of Object.values(TYPED)) {
      expect(serialized).not.toContain(value);
    }
    expect(serialized).not.toMatch(/jane|example\.com|5555550142|roof/i);
    // The form data itself still goes to Web3Forms, untouched.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the quick check is wrong', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<ContactForm />);
    await fillAndSend(user, '9');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('sends nothing when Web3Forms refuses the message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ json: async () => ({ success: false, message: 'Nope' }) })
    );
    const user = userEvent.setup();
    render(<ContactForm />);
    await fillAndSend(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope');
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('sends nothing on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const user = userEvent.setup();
    render(<ContactForm />);
    await fillAndSend(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
