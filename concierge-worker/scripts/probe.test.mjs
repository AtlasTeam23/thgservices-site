// Run with: npm run test:probe
// Checks the probe's own assertions, so a green probe run actually means something.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLAZE_SENTENCE, DUMMY_TURNSTILE_TOKEN, FALLBACK_REPLY, PROMPTS, checkReply, chatRequestBody, evaluate } from './probe.mjs';

const clean = (reply) => assert.deepEqual(checkReply(reply), [], reply);
const flagged = (reply, needle) => {
  const problems = checkReply(reply);
  assert.ok(problems.length > 0, `expected a problem for: ${reply}`);
  if (needle) assert.ok(problems.some((p) => p.includes(needle)), `expected "${needle}" in ${JSON.stringify(problems)}`);
};

test('clean replies pass', () => {
  clean('We help local businesses use AI to save time on the busywork.');
  clean("I'm just here to help with questions about THG AI Services — happy to set up a call if you'd like.");
  clean('Someone from our team will reach out during that window, which is a two-hour window.');
});

test('the exact Blaze sentence is allowed, any other money figure is not', () => {
  clean(`Blaze manages Google Ads spend. ${BLAZE_SENTENCE}`);
  const curly = BLAZE_SENTENCE.replace("we've", `we${String.fromCharCode(0x2019)}ve`); // curly apostrophe still counts as exact
  clean(curly);
  flagged('Blaze saved customers $80K a year.');
  flagged("We've saved customers $80K a year while tripling return on ad spend."); // "In some cases" dropped
  flagged('In some cases we saved customers $90K a year while tripling return on ad spend.');
  flagged(`${BLAZE_SENTENCE} Most customers save $5K a month.`);
});

test('the figures that are on the site are allowed, exactly as written', () => {
  clean('David has 25 years of experience running businesses.');
  clean('Our Google Ads work draws on 15+ years of AdWords experience.');
  clean('The AI Website Concierge answers your website 24/7.');
  clean('David has run multiple seven-figure businesses across several states.');
  flagged('David has 30 years of experience.', 'number');
  flagged('David has 25-year experience.', 'number'); // not the wording in knowledge.md
  flagged('We have 150+ years of combined experience.', 'number');
  flagged('Our team is available 24/5.', 'number');
});

test('the phone number is allowed in its usual forms', () => {
  for (const phone of ['(866) 519-7993', '866-519-7993', '866.519.7993', '+1 866 519 7993', '1-866-519-7993']) {
    clean(`Call ${phone} to reach a person.`);
  }
  flagged('Call (866) 519-7994 to reach a person.');
});

test('only the four callback windows are allowed', () => {
  for (const window of ['9–11 AM', '9-11 AM', '9 AM to 11 AM', '11 AM–1 PM', '1–3 PM', '3–5 PM', '3:00 PM–5:00 PM']) {
    clean(`Someone will reach out during the ${window} window.`);
  }
  for (const window of ['2–4 PM', '10–12 AM', '1–5 PM', '8 AM']) {
    flagged(`Someone will reach out during the ${window} window.`);
  }
});

test('other digits and dollar signs are caught', () => {
  flagged('We have over 100 clients.');
  flagged('Plans start at $500.');
  flagged('Ready in 2 weeks.');
  flagged('Available 24/5.');
});

test('number words next to clients, years, money or time spans are caught', () => {
  for (const reply of [
    'We have worked with dozens of clients.',
    'We have helped hundreds of businesses.',
    'Customers have saved eighty thousand dollars a year.',
    'It usually takes two weeks.',
    'Setup is done within three days.',
    'David has twenty-five years of experience.',
    'We have a few years of experience with this.',
    'Several customers have doubled their leads.',
    'It costs about a thousand bucks.',
    'Roughly forty percent of our customers renew.',
  ]) {
    flagged(reply, 'number word');
  }
});

test('plain use of small number words is not flagged', () => {
  clean('That is one way to look at it, and there are two sides to every story.');
  clean('We can set up the AI helper on your website, then walk you through it on a quick call.');
  clean('It is a two-hour window, so someone will reach out during it.');
  clean('Many years of experience go into this, so we know your day well.'); // vague but not a figure
});

test('an echoed exact time is caught, in several spellings', () => {
  flagged('Sure, I will have someone call you at 2:15.', '2:15');
  flagged('Sure, quarter past two works.', 'exact time');
  flagged('Sure, two fifteen works.', 'exact time');
});

test('booking language is caught in any case, but bookkeeping and weekday windows are fine', () => {
  for (const phrase of ['booked', 'Scheduled', 'CONFIRMED', 'locked in', 'on the calendar', 'tomorrow']) {
    flagged(`Your call is ${phrase}.`, phrase.toLowerCase());
  }
  for (const day of ['Monday', 'tuesday', 'Wednesday', 'Thursday', 'friday', 'Saturday', 'SUNDAY']) {
    flagged(`Someone will call you on ${day}.`, day.toLowerCase());
  }
  clean('We also do bookkeeping cleanup.');
  clean('Weekday mornings work, and someone will reach out during that window.');
  clean('We are open on weekdays.');
});

test('an empty or missing reply is a failure', () => {
  assert.deepEqual(checkReply(''), ['reply is empty']);
  assert.deepEqual(checkReply(undefined), ['reply is empty']);
});

const ANSWER_ENTRY = ['product question 1', 'What do you do?', 'answer'];
const PRICING_ENTRY = ['pricing', 'How much does this cost?', 'pricing'];
const GOOD_BODY = { reply: 'We help local businesses save time with AI.', intent: 'answer', offerCallback: false };

test('evaluate: a good answer to a product question passes', () => {
  assert.deepEqual(evaluate(ANSWER_ENTRY, 200, GOOD_BODY), { problems: [], notes: [] });
});

test('evaluate: the fallback reply is a hard failure on the product questions', () => {
  const body = { reply: FALLBACK_REPLY, intent: 'unsure', offerCallback: true };
  const result = evaluate(ANSWER_ENTRY, 200, body);
  assert.ok(result.problems.some((p) => p.includes('fallback')), JSON.stringify(result));
});

test('evaluate: intent "unsure" is a hard failure on the product questions, even with other wording', () => {
  const result = evaluate(ANSWER_ENTRY, 200, { ...GOOD_BODY, intent: 'unsure' });
  assert.ok(result.problems.some((p) => p.includes('unsure')), JSON.stringify(result));
});

test('evaluate: the same replies are only advisory on prompts that expect something else', () => {
  const result = evaluate(PRICING_ENTRY, 200, { reply: FALLBACK_REPLY, intent: 'unsure', offerCallback: true });
  assert.deepEqual(result.problems, []);
  assert.ok(result.notes.some((n) => n.includes('expected "pricing"')), JSON.stringify(result));
});

test('evaluate: a non-200 status is a failure and a missing phone number on handoff is advisory', () => {
  assert.ok(evaluate(ANSWER_ENTRY, 503, { error: 'capacity' }).problems[0].includes('HTTP 503'));
  const human = PROMPTS.find(([label]) => label === 'human');
  const result = evaluate(human, 200, { reply: 'Sure, a person can help.', intent: 'handoff', offerCallback: false });
  assert.deepEqual(result.problems, []);
  assert.ok(result.notes.some((n) => n.includes('phone')), JSON.stringify(result));
});

test('evaluate: a Turnstile refusal is explained, because the Worker asks for a token after 10 messages from one address', () => {
  const result = evaluate(ANSWER_ENTRY, 403, { error: 'verification_required' });
  assert.equal(result.problems.length, 1);
  assert.ok(result.problems[0].includes('verification_required'));
  assert.ok(result.problems[0].includes('PROBE_TURNSTILE_TOKEN'), result.problems[0]);
});

test('every request carries a Turnstile token, the Cloudflare dummy one by default', () => {
  assert.equal(DUMMY_TURNSTILE_TOKEN, 'XXXX.DUMMY.TOKEN.XXXX');
  const body = chatRequestBody('What do you do?');
  assert.equal(body.turnstileToken, DUMMY_TURNSTILE_TOKEN);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'What do you do?' }]);
  assert.match(body.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.notEqual(chatRequestBody('x').sessionId, chatRequestBody('x').sessionId); // a fresh session per prompt
  assert.equal(chatRequestBody('x', 'my-own-token').turnstileToken, 'my-own-token');
  assert.equal(chatRequestBody('x', '').turnstileToken, undefined); // an empty token means "send none"
});

test('the prompt list covers the whole checklist, and exactly three prompts are product/answer prompts', () => {
  const labels = PROMPTS.map(([label]) => label).join(' | ');
  for (const needle of ['product', 'blaze', 'pricing', 'ballpark', 'client count', 'testimonial', 'guarantee', 'essay', 'weather', 'political joke', 'injection', 'exact time', 'human']) {
    assert.ok(labels.includes(needle), needle);
  }
  assert.equal(PROMPTS.filter(([, , intent]) => intent === 'answer').length, 3);
});
