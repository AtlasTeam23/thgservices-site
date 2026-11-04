import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => ({ postChat: vi.fn(), postLead: vi.fn() }));
vi.mock('../turnstile', () => ({ getToken: vi.fn() }));
vi.mock('../../../lib/track', () => ({ track: vi.fn() }));

import { Concierge, openConcierge } from '../index';
import { postChat, postLead } from '../api';
import { track } from '../../../lib/track';
import * as copy from '../copy';

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.mocked(postChat).mockResolvedValue({
    kind: 'ok',
    data: { reply: 'Here to help.', intent: 'answer', offerCallback: false },
  });
});

describe('Concierge bubble', () => {
  it('renders a labelled button and nothing else until it is used', () => {
    render(<Concierge />);
    const bubble = screen.getByRole('button', { name: copy.BUBBLE_LABEL });
    expect(bubble).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(postChat).not.toHaveBeenCalled();
  });

  it('opens the panel on click, tracks it, and shows the greeting', async () => {
    const user = userEvent.setup();
    render(<Concierge />);
    await user.click(screen.getByRole('button', { name: copy.BUBBLE_LABEL }));

    expect(await screen.findByRole('dialog', { name: copy.PANEL_TITLE })).toBeInTheDocument();
    expect(await screen.findByText(copy.GREETING)).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith('concierge_open', { source: 'bubble' });
    // The bubble's own name never changes; aria-expanded carries the state.
    expect(screen.getByRole('button', { name: copy.BUBBLE_LABEL, expanded: true })).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveFocus();
  });

  it('closes on Escape and returns focus to the bubble', async () => {
    const user = userEvent.setup();
    render(<Concierge />);
    await user.click(screen.getByRole('button', { name: copy.BUBBLE_LABEL }));
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const bubble = screen.getByRole('button', { name: copy.BUBBLE_LABEL });
    expect(bubble).toHaveFocus();
    expect(bubble).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles closed when the bubble is clicked while open', async () => {
    const user = userEvent.setup();
    render(<Concierge />);
    await user.click(screen.getByRole('button', { name: copy.BUBBLE_LABEL }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: copy.BUBBLE_LABEL, expanded: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reopens with the earlier thread intact', async () => {
    const user = userEvent.setup();
    render(<Concierge />);
    await user.click(screen.getByRole('button', { name: copy.BUBBLE_LABEL }));
    await user.click(await screen.findByRole('button', { name: 'What do you do?' }));
    await screen.findByText('Here to help.');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: copy.BUBBLE_LABEL }));
    expect(await screen.findByText('Here to help.')).toBeInTheDocument();
    expect(postChat).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(copy.GREETING)).toHaveLength(1);
  });

  it('opens from openConcierge() and runs the quick reply', async () => {
    render(<Concierge />);
    act(() => openConcierge({ source: 'section_cta', quickReply: 'Try the AI Concierge' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText('Here to help.')).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith('concierge_open', { source: 'section_cta' });
    expect(track).toHaveBeenCalledWith('concierge_quick_reply', { chip: 'Try the AI Concierge' });
    expect(vi.mocked(postChat).mock.calls[0][0].messages[0].content).toBe('Try the AI Concierge');
  });

  it('keeps the visible label equal to the accessible name, open or closed', async () => {
    const user = userEvent.setup();
    const { container } = render(<Concierge />);
    const label = () => container.querySelector('.thg-cc-bubble-label')?.textContent;
    expect(label()).toBe(copy.BUBBLE_LABEL);
    await user.click(screen.getByRole('button', { name: copy.BUBBLE_LABEL }));
    await screen.findByRole('dialog');
    expect(label()).toBe(copy.BUBBLE_LABEL);
    expect(screen.getByRole('button', { name: copy.BUBBLE_LABEL })).toHaveAttribute('aria-expanded', 'true');
  });

  it('captures the UTM parameters when the page loads, before the chat is opened', () => {
    window.history.replaceState({}, '', '/?utm_source=google&utm_medium=cpc&ref=x');
    render(<Concierge />);
    const stored = JSON.parse(window.sessionStorage.getItem('thg-concierge-v1') ?? 'null');
    expect(stored.utm).toEqual({ utm_source: 'google', utm_medium: 'cpc' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    window.history.replaceState({}, '', '/');
  });

  it('sends the load-time UTM with a lead even if the URL changed before the chat was opened', async () => {
    const user = userEvent.setup();
    vi.mocked(postLead).mockResolvedValue({ kind: 'ok', delivery: 'email' });
    window.history.replaceState({}, '', '/?utm_source=google&utm_campaign=spring');
    render(<Concierge />);
    window.history.replaceState({}, '', '/#ai-concierge'); // the visitor scrolled around; no UTM now

    act(() => openConcierge({ source: 'section_cta', quickReply: 'Request a callback' }));
    await user.type(await screen.findByLabelText('Name'), 'Jane Doe');
    await user.type(screen.getByLabelText('Phone'), '7705551234');
    await user.type(screen.getByLabelText('Business name'), 'Doe Plumbing');
    await user.selectOptions(screen.getByLabelText('Best callback window'), 'morning_9_11');
    await user.click(screen.getByLabelText(copy.CONSENT));
    await user.click(screen.getByRole('button', { name: 'Request my callback' }));

    expect(vi.mocked(postLead).mock.calls[0][0].page).toEqual({
      url: window.location.href,
      utm: { utm_source: 'google', utm_campaign: 'spring' },
    });
    window.history.replaceState({}, '', '/');
  });

  it('honours a second openConcierge() call after the panel was closed', async () => {
    const user = userEvent.setup();
    render(<Concierge />);
    act(() => openConcierge({ source: 'bubble' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    act(() => openConcierge({ source: 'section_cta', quickReply: 'What do you do?' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await screen.findByText('Here to help.');
    expect(postChat).toHaveBeenCalledTimes(1);
  });
});
