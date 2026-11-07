import { describe, expect, it } from 'vitest';
import * as copy from '../copy';

// The Worker reuses RATE_LIMITED, LEAD_ONLY, ENDED and TOO_LONG word for word,
// so these strings are part of the API contract (plan section 2.7).
describe('concierge copy (contract section 2.7)', () => {
  it('has the exact fixed strings', () => {
    expect(copy.BUBBLE_LABEL).toBe('Questions? Chat with us');
    expect(copy.PANEL_TITLE).toBe('THG AI Concierge Agent');
    expect(copy.DISCLOSURE).toBe(
      "You're chatting with an AI assistant. Don't share sensitive info."
    );
    expect(copy.GREETING).toBe(
      "Hi there! I'm the THG AI Concierge Agent. I can answer questions about how we help local businesses save time with AI, or set up a quick call with David's team. You can type a question below at any time. What can I help with?"
    );
    expect(copy.CHIPS).toEqual([
      'What do you do?',
      'Try the AI Concierge',
      'Request a callback',
    ]);
    expect(copy.OFFER_CHIPS).toEqual(['Yes, call me']);
    expect(copy.CALLBACK_INTRO).toBe(
      'Happy to set that up. Fill in a few details and someone from our team will reach out during the window you pick.'
    );
    expect(copy.HANDOFF).toBe(
      'You got it — call (866) 519-7993 to reach a person on our team.'
    );
    expect(copy.RATE_LIMITED).toBe(
      "Let's keep going by phone — call (866) 519-7993."
    );
    expect(copy.LEAD_ONLY).toBe(
      'Our chat helper is taking a short break. Leave your info and someone from our team will call you back.'
    );
    expect(copy.ENDED).toBe(
      "I'm going to step out of this chat. If you'd like to talk with the team, call (866) 519-7993."
    );
    expect(copy.ERROR).toBe(
      'Something hiccuped on our end. You can try again, or call (866) 519-7993.'
    );
    expect(copy.DELIVERY_FAILED).toBe(
      "I couldn't send that just now. Please call (866) 519-7993 and we'll take care of you."
    );
    expect(copy.TOO_LONG).toBe(
      'That message is a bit long for me — could you keep it under 1,000 characters?'
    );
    expect(copy.FOOTER_CALL).toBe('Prefer to talk? Call (866) 519-7993');
    expect(copy.FOOTER_AI).toBe('AI assistant — may make mistakes.');
    expect(copy.FOOTER_PRIVACY).toBe('Privacy');
    expect(copy.PRIVACY_HREF).toBe('/privacy.html#ai-chat');
    expect(copy.CONSENT).toBe(
      'OK to contact me by phone, text, or email about my request.'
    );
    expect(copy.LEAD_FORM_HEADING).toBe("Here's what I have. Check the box and tap send.");
    expect(copy.LEAD_FORM_DISMISS).toBe('Not now, keep chatting');
  });

  it('knows the site quick replies (website checker) as runnable, but does not list them as chips', () => {
    expect(copy.SITE_QUICK_REPLIES).toEqual([
      'I just checked my website and want help with the results',
      'The website checker could not read my site and I would like a person to look at it',
    ]);
    for (const label of copy.SITE_QUICK_REPLIES) {
      expect(copy.isKnownChip(label)).toBe(true);
      expect((copy.CHIPS as readonly string[]).includes(label)).toBe(false);
    }
    expect(copy.isKnownChip('Something else entirely')).toBe(false);
  });

  it('labels the four callback windows', () => {
    expect(copy.WINDOWS).toEqual({
      morning_9_11: 'Weekday morning (9–11 AM ET)',
      midday_11_1: 'Midday (11 AM–1 PM ET)',
      afternoon_1_3: 'Afternoon (1–3 PM ET)',
      late_afternoon_3_5: 'Late afternoon (3–5 PM ET)',
    });
    expect(copy.WINDOW_KEYS).toEqual([
      'morning_9_11',
      'midday_11_1',
      'afternoon_1_3',
      'late_afternoon_3_5',
    ]);
  });

  it('builds the confirmation message from first name and window label', () => {
    expect(copy.CONFIRM('Jane', copy.WINDOWS.midday_11_1)).toBe(
      "Thanks, Jane! Someone from our team will reach out during your Midday (11 AM–1 PM ET) window. If it's urgent, call (866) 519-7993."
    );
  });

  it('recognises only its own chips', () => {
    for (const chip of [...copy.CHIPS, ...copy.OFFER_CHIPS]) expect(copy.isKnownChip(chip)).toBe(true);
    for (const other of ['', 'hello', 'what do you do?', 'Call me at 555-0100']) {
      expect(copy.isKnownChip(other)).toBe(false);
    }
  });

  it('exposes the phone number once, in display and href form', () => {
    expect(copy.PHONE_DISPLAY).toBe('(866) 519-7993');
    expect(copy.PHONE_HREF).toBe('tel:+18665197993');
  });
});
