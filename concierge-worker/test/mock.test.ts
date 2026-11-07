import { describe, expect, it } from 'vitest';
import { generateReply } from '../src/llm';
import type { ChatMessage } from '../src/validation';
import { testEnv } from './helpers';

// The mock provider stands in for the model when no key is set. Besides the canned answers it plays
// the part of the conversational helper: it asks for contact details one step at a time, carries what
// it has learned forward in `lead`, and sets `readyToConfirm` once it has a name and a phone number.
// That lets the widget's collection flow be built and tested without a key.

const user = (content: string): ChatMessage => ({ role: 'user', content });
const assistant = (content: string): ChatMessage => ({ role: 'assistant', content });
const reply = (turns: ChatMessage[]) => generateReply(testEnv(), turns);

const NO_LEAD = { name: '', phone: '', email: '', business: '', need: '', callbackWindow: '' };

/** Plays a whole scripted visitor side against the mock, feeding its own replies back in. */
const converse = async (...visitorLines: string[]) => {
  const turns: ChatMessage[] = [];
  const replies = [];
  for (const line of visitorLines) {
    turns.push(user(line));
    const result = await reply(turns);
    replies.push(result);
    turns.push(assistant(result.reply));
  }
  return replies;
};

describe('mock provider: every reply carries the new fields', () => {
  it.each(['What do you do?', 'How much does it cost?', 'Can I talk to a person?', 'tell me a joke', 'I need a quote'])(
    'adds readyToConfirm: false and an empty lead to the reply to %j',
    async (text) => {
      const result = await reply([user(text)]);
      expect(result.readyToConfirm).toBe(false);
      expect(result.lead).toEqual(NO_LEAD);
    },
  );
});

describe('mock provider: asking for a call starts the collection', () => {
  it.each(['can you have someone call me?', 'Can you call me?', 'Request a callback', 'please call me back', 'have David call me'])(
    'asks for a name when the visitor says %j',
    async (text) => {
      const result = await reply([user(text)]);
      expect(result.intent).toBe('collecting');
      expect(result.offerCallback).toBe(false);
      expect(result.readyToConfirm).toBe(false);
      expect(result.reply).toMatch(/your name/i);
      expect(result.lead).toEqual(NO_LEAD);
    },
  );

  it('still offers a callback, as before, for a quote or a demo request', async () => {
    for (const text of ['I need a quote', 'Show me a demo']) {
      const result = await reply([user(text)]);
      expect(result.offerCallback).toBe(true);
      expect(result.intent).toBe('answer');
      expect(result.reply).toMatch(/Want me to have someone call you\?$/);
    }
  });
});

describe('mock provider: a phone number', () => {
  it('returns it normalized in lead and keeps collecting, asking for the missing name', async () => {
    const result = await reply([user('My number is 770-555-0147, can you have David call me?')]);
    expect(result.intent).toBe('collecting');
    expect(result.lead).toEqual({ ...NO_LEAD, phone: '7705550147' });
    expect(result.readyToConfirm).toBe(false);
    expect(result.reply).toMatch(/your name/i);
  });

  it.each([
    ['(770) 555-0147', '7705550147'],
    ['770.555.0147', '7705550147'],
    ['+1 770 555 0147', '7705550147'],
    ['1-770-555-0147', '7705550147'],
    ['7705550147', '7705550147'],
  ])('recognizes %j as %j', async (written, expected) => {
    const result = await reply([user(`you can reach me at ${written} any time`)]);
    expect(result.lead.phone).toBe(expected);
  });

  it.each(['my number is 770-555-014', 'room 12345 please', 'the year 2026', 'call 911'])('does not mistake %j for a phone number', async (text) => {
    const result = await reply([user(text)]);
    expect(result.lead.phone).toBe('');
  });

  it('uses the latest number when the visitor gives a corrected one', async () => {
    const replies = await converse('my number is 770-555-0147', 'sorry, make that 404-555-0199');
    expect(replies[1]!.lead.phone).toBe('4045550199');
  });
});

describe('mock provider: a name', () => {
  it('recognizes "my name is X" and asks for the phone number next', async () => {
    const result = await reply([user('Hi, my name is Dana Lee')]);
    expect(result.intent).toBe('collecting');
    expect(result.lead).toEqual({ ...NO_LEAD, name: 'Dana Lee' });
    expect(result.readyToConfirm).toBe(false);
    expect(result.reply).toMatch(/phone number/i);
    expect(result.reply).toContain('Dana');
  });

  it("recognizes \"my name's X\" and stops at the end of the name", async () => {
    const result = await reply([user("my name's Dana Lee and I run a plumbing company")]);
    expect(result.lead.name).toBe('Dana Lee');
  });

  it('takes a bare reply as the name when the helper has just asked for one', async () => {
    const result = await reply([user('can you have someone call me?'), assistant('Happy to set that up. What is your name?'), user('Dana Lee')]);
    expect(result.lead.name).toBe('Dana Lee');
    expect(result.intent).toBe('collecting');
    expect(result.reply).toMatch(/phone number/i);
  });

  it('does not take a bare reply as a name when nothing asked for one', async () => {
    const result = await reply([user('Dana Lee')]);
    expect(result.lead.name).toBe('');
    expect(result.intent).toBe('answer');
  });

  it.each(['yes call me', 'No thanks', 'what do you do', 'ok sure please', 'how much is it', 'sounds good thanks'])(
    'does not take %j for a name even right after the helper asked',
    async (text) => {
      const result = await reply([user('call me'), assistant('Happy to set that up. What is your name?'), user(text)]);
      expect(result.lead.name).toBe('');
    },
  );

  it('does not take a long sentence or something with digits as a name', async () => {
    const asked = [user('call me'), assistant('What is your name?')];
    expect((await reply([...asked, user('well I was thinking about it for a while now')])).lead.name).toBe('');
    expect((await reply([...asked, user('Dana 2')])).lead.name).toBe('');
  });
});

describe('mock provider: readyToConfirm', () => {
  it('is true when a name and a phone number are both in the message', async () => {
    const result = await reply([user('My name is Dana Lee and my number is (770) 555-0147')]);
    expect(result.readyToConfirm).toBe(true);
    expect(result.intent).toBe('collecting');
    expect(result.lead).toMatchObject({ name: 'Dana Lee', phone: '7705550147' });
    expect(result.reply).toMatch(/Check the box below and tap send/);
    expect(result.reply).toContain('Dana');
  });

  it('is true when they arrive on different turns, as in the three-turn flow', async () => {
    const replies = await converse('can you have someone call me?', 'Dana Lee', '770-555-0147');
    expect(replies.map((r) => r.intent)).toEqual(['collecting', 'collecting', 'collecting']);
    expect(replies.map((r) => r.readyToConfirm)).toEqual([false, false, true]);
    expect(replies[0]!.reply).toMatch(/your name/i);
    expect(replies[1]!.reply).toMatch(/phone number/i);
    expect(replies[2]!.lead).toMatchObject({ name: 'Dana Lee', phone: '7705550147' });
  });

  it('works whichever of the two comes first', async () => {
    const replies = await converse('my number is 770-555-0147', 'my name is Dana Lee');
    expect(replies.map((r) => r.readyToConfirm)).toEqual([false, true]);
  });

  it('is false with only a name, and false with only a phone number', async () => {
    expect((await reply([user('my name is Dana Lee')])).readyToConfirm).toBe(false);
    expect((await reply([user('my number is 770-555-0147')])).readyToConfirm).toBe(false);
  });

  it('stays true on later replies once both have appeared, with the details carried forward', async () => {
    const replies = await converse('My name is Dana Lee and my number is 770-555-0147', 'What do you do?');
    expect(replies[1]!.intent).toBe('answer'); // an ordinary question still gets an ordinary answer
    expect(replies[1]!.readyToConfirm).toBe(true);
    expect(replies[1]!.lead).toMatchObject({ name: 'Dana Lee', phone: '7705550147' });
  });
});

describe('mock provider: the other lead fields', () => {
  it('picks up an email address, a business name and a callback window', async () => {
    const replies = await converse(
      'my name is Dana Lee and my email is dana@example.com',
      'my business is Lee Plumbing',
      'afternoon would be best',
      'my number is 770-555-0147',
    );
    expect(replies[0]!.lead.email).toBe('dana@example.com');
    expect(replies[1]!.lead.business).toBe('Lee Plumbing');
    expect(replies[2]!.lead.callbackWindow).toBe('afternoon_1_3');
    expect(replies[3]!.lead).toEqual({
      name: 'Dana Lee',
      phone: '7705550147',
      email: 'dana@example.com',
      business: 'Lee Plumbing',
      need: '',
      callbackWindow: 'afternoon_1_3',
    });
  });

  it.each([
    ['late afternoon works', 'late_afternoon_3_5'],
    ['mornings are best', 'morning_9_11'],
    ['around midday', 'midday_11_1'],
    ['after lunch, maybe afternoon', 'afternoon_1_3'],
  ])('reads %j as %j', async (text, expected) => {
    const result = await reply([user(`my number is 770-555-0147, ${text}`)]);
    expect(result.lead.callbackWindow).toBe(expected);
  });

  it('does not treat a window word as a lead when no details are being given', async () => {
    const result = await reply([user('do you work in the morning?')]);
    expect(result.lead).toEqual(NO_LEAD);
  });
});

describe('mock provider: precedence with the older canned answers', () => {
  it('still answers a pricing question with the pricing line when no details were given', async () => {
    expect((await reply([user('how much does it cost to have someone call me?')])).intent).toBe('pricing');
  });

  it('still hands off for a human', async () => {
    expect((await reply([user('I want to talk to a person')])).intent).toBe('handoff');
  });

  it('treats a message with a phone number as collecting even if it also says "call"', async () => {
    expect((await reply([user('call me on 770-555-0147')])).intent).toBe('collecting');
  });
});
