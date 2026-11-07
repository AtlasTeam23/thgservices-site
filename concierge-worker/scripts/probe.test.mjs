// Run with: npm run test:probe
// Checks the probe's own assertions, so a green probe run actually means something.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BLAZE_SENTENCE,
  COLLECTION_FLOW,
  DUMMY_TURNSTILE_TOKEN,
  FALLBACK_REPLY,
  OWNER_PROMPTS,
  PHONE_ECHO,
  PHONE_PROMPT,
  PROMPTS,
  REMOTE_EXPECTED_WORDS,
  REMOTE_FORBIDDEN_PHRASES,
  REMOTE_PROMPT,
  SERVICE_PROMPTS,
  checkForbiddenPhrases,
  checkFormQuestions,
  checkReply,
  chatRequestBody,
  clientIpFor,
  endsWithCallbackQuestion,
  evaluate,
  evaluateFlow,
  evaluateOwnerGroup,
  parseArgs,
} from './probe.mjs';

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

test('only the four callback windows are allowed, in every phrasing the prompt uses', () => {
  const written = [
    // with AM/PM, en dash or hyphen
    '9–11 AM', '9-11 AM', '9 AM to 11 AM', '11 AM–1 PM', '11 AM-1 PM', '1–3 PM', '1-3 PM', '3–5 PM', '3-5 PM', '3:00 PM–5:00 PM',
    // without AM/PM
    '9–11', '9-11', '11–1', '11-1', '1–3', '1-3', '3–5', '3-5',
    // AM/PM on only one end
    '11–1 PM', '9 AM–11', '11 AM–1',
  ];
  for (const window of written) clean(`Someone will reach out during the ${window} window.`);
  clean('We have the weekday morning 9–11, midday 11–1, afternoon 1–3, or late afternoon 3–5 windows.');
  for (const window of ['2–4 PM', '2–4', '10–12 AM', '10–12', '1–5 PM', '1–5', '9–12', '8 AM', '4–6', '12–2']) {
    flagged(`Someone will reach out during the ${window} window.`);
  }
});

test('a bare window-shaped pair is not allowed when it is really a count of something', () => {
  for (const phrase of ['9–11 clients', '3-5 years', '1–3 weeks', '11-1 dollars', '1-3 months', '9–11 customers', '3–5 days', '1-3 percent']) {
    flagged(`We usually see ${phrase}.`);
  }
});

test('the phrase "10-digit" is allowed, because the prompt asks for a 10-digit phone number', () => {
  clean('Could you share a 10-digit phone number?');
  clean('I just need a 10 digit number to reach you.');
  clean('Please give me your 10-Digit US phone number.');
  flagged('We have 10 clients.');
  flagged('That is a 100-digit number.');
  flagged('Call 10 days from now.');
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

test('an exact time stays a hard failure even when a window is named alongside it', () => {
  flagged('2:15 is inside the afternoon 1–3 PM window, so someone will call then.', '2:15');
  flagged('Someone will reach out around 2:15 during the 1–3 window.', '2:15');
  flagged('Quarter past two falls in the afternoon 1–3 PM window.', 'exact time');
  flagged('Two fifteen is in the 1–3 window.', 'exact time');
  clean('That falls in the afternoon 1–3 PM window. Someone from our team will reach out during that window.');
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

// --- conversational update: things the helper must never say --------------------------

test('the helper must not talk about its knowledge, its instructions, or being an AI', () => {
  flagged("The knowledge I have doesn't list restaurants.", 'knowledge');
  flagged('Based on my knowledge base, yes we do.', 'knowledge');
  flagged('Sorry, I cannot share my instructions.', 'instructions');
  flagged('As an AI, I cannot do that.', 'as an AI');
  flagged('AS AN AI helper I do not know.', 'as an AI');
  clean('We are knowledgeable about what local businesses need.');
  clean('Our team can walk you through the setup on a quick call.');
});

test('a number the visitor typed may be echoed, but only when the prompt allows it', () => {
  flagged('Thanks! I have 770-555-0147 for you.');
  assert.deepEqual(checkReply('Thanks! I have 770-555-0147 for you.', { allow: [PHONE_ECHO] }), []);
  assert.deepEqual(checkReply('Thanks! I have (770) 555-0147 for you.', { allow: [PHONE_ECHO] }), []);
  assert.deepEqual(checkReply('Thanks! I have 7705550147 for you.', { allow: [PHONE_ECHO] }), []);
  assert.notDeepEqual(checkReply('Thanks! I have 404-555-0199 for you.', { allow: [PHONE_ECHO] }), []); // someone else's number
  assert.notDeepEqual(checkReply('That will be $500.', { allow: [PHONE_ECHO] }), []); // allowing the echo allows nothing else
});

test('endsWithCallbackQuestion spots the stock closing question, and only at the end', () => {
  assert.equal(endsWithCallbackQuestion('Yes, we do. Want me to have someone call you?'), true);
  assert.equal(endsWithCallbackQuestion('Yes, we do. Want me to have someone call you?  \n'), true);
  assert.equal(endsWithCallbackQuestion('Yes, we do. want me to have someone call you?'), true);
  assert.equal(endsWithCallbackQuestion('Want me to have someone call you? Just say the word.'), false);
  assert.equal(endsWithCallbackQuestion('Does that sound like your situation?'), false);
  assert.equal(endsWithCallbackQuestion(''), false);
  assert.equal(endsWithCallbackQuestion(undefined), false);
});

// --- owner questions -------------------------------------------------------------------

const ownerBody = (reply) => ({ reply, intent: 'answer', offerCallback: false, readyToConfirm: false, lead: {} });

test('there are five owner questions, all expecting an ordinary answer, and restaurants is one of them', () => {
  assert.equal(OWNER_PROMPTS.length, 5);
  assert.ok(OWNER_PROMPTS.every(([, , intent]) => intent === 'answer'));
  assert.ok(OWNER_PROMPTS.some(([, prompt]) => /restaurants/i.test(prompt)));
  assert.equal(new Set(OWNER_PROMPTS.map(([, prompt]) => prompt)).size, 5);
});

test('an owner answer that talks about its knowledge is a failure, and so is the fallback or "unsure"', () => {
  const entry = OWNER_PROMPTS[0];
  assert.deepEqual(evaluate(entry, 200, ownerBody('Yes, restaurants are a good fit for call handling.')), { problems: [], notes: [] });
  assert.ok(evaluate(entry, 200, ownerBody("The knowledge I have doesn't list restaurants.")).problems.some((p) => p.includes('knowledge')));
  assert.ok(evaluate(entry, 200, { ...ownerBody(FALLBACK_REPLY), intent: 'unsure' }).problems.length >= 1);
});

test('evaluateOwnerGroup allows at most two of the five answers to end with the callback question', () => {
  const ask = 'Yes. Want me to have someone call you?';
  const plain = 'Yes, that is a good fit.';
  assert.deepEqual(evaluateOwnerGroup([ask, ask, plain, plain, plain]), []);
  assert.deepEqual(evaluateOwnerGroup([plain, plain, plain, plain, plain]), []);
  const problems = evaluateOwnerGroup([ask, ask, ask, plain, plain]);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('3 of 5'), problems[0]);
  assert.ok(evaluateOwnerGroup([ask, ask, ask, ask, ask])[0].includes('5 of 5'));
  assert.deepEqual(evaluateOwnerGroup([]), []);
});

test('the four service prompts expect an affirmative answer: fallback, "unsure" and stray numbers fail', () => {
  assert.deepEqual(SERVICE_PROMPTS.map(([, prompt]) => prompt), [
    'Do you do SEO?',
    "Can you look at my website and tell me what's wrong with it?",
    'Can you grade my website?',
    'What would my website score?',
  ]);
  assert.ok(SERVICE_PROMPTS.every(([, , intent]) => intent === 'answer'));
  assert.ok(!SERVICE_PROMPTS.some(([, prompt]) => OWNER_PROMPTS.some(([, p]) => p === prompt)));
  const [seo, review] = SERVICE_PROMPTS;
  assert.equal(OWNER_PROMPTS.length + SERVICE_PROMPTS.length + 2 + PROMPTS.length + COLLECTION_FLOW.length, 29); // the README says the probe sends 29
  assert.deepEqual(evaluate(seo, 200, ownerBody('Yes, we do SEO: on-page fixes, local search, your Google Business Profile, and content for the services you sell.')), { problems: [], notes: [] });
  assert.deepEqual(evaluate(review, 200, ownerBody('Yes, we can review your site for search readiness, mobile, speed, tracking, and lead capture, then give you a plain-language fix list.')), { problems: [], notes: [] });
  for (const entry of SERVICE_PROMPTS) {
    assert.ok(evaluate(entry, 200, ownerBody(FALLBACK_REPLY)).problems.length >= 1);
    assert.ok(evaluate(entry, 200, { ...ownerBody('Not sure.'), intent: 'unsure' }).problems.length >= 1);
    assert.ok(evaluate(entry, 200, ownerBody('Yes, and we have 50 clients who love it.')).problems.length >= 1);
  }
});

test('the two grade prompts need the website checker and no guessed grade or score', () => {
  const [, , grade, score] = SERVICE_PROMPTS;
  const OK = 'We have a free website checker at thgservices.io/website-checker/. It grades how easy your site is to find and how well it turns visitors into customers.';
  for (const entry of [grade, score]) {
    assert.deepEqual(evaluate(entry, 200, ownerBody(OK)), { problems: [], notes: [] });
    assert.ok(evaluate(entry, 200, ownerBody('A quick call with the team can sort that out.')).problems.some((p) => p.includes('website checker')));
    assert.ok(evaluate(entry, 200, ownerBody(FALLBACK_REPLY)).problems.length >= 1);
    assert.ok(evaluate(entry, 200, { ...ownerBody(OK), intent: 'unsure' }).problems.length >= 1);
    for (const guess of [
      `${OK} I would guess you get a B.`,
      `${OK} Probably grade: C.`,
      `${OK} It sounds like an A+.`,
      `${OK} Your site would score a D.`,
      `${OK} Around 80 out of 100.`,
      `${OK} Maybe 70/100.`,
    ]) {
      assert.ok(evaluate(entry, 200, ownerBody(guess)).problems.length >= 1, guess);
    }
  }
  // An ordinary capital A at the start of a sentence is not a grade.
  assert.deepEqual(evaluate(grade, 200, ownerBody(`${OK} A quick call is also fine. Better sites welcome.`)), { problems: [], notes: [] });
});

// --- remote only: no in-person visit ---------------------------------------------------

const REMOTE_OK = 'We do everything online. We start with a quick call, then a video meeting, and set things up remotely.';

test('the shop-visit prompt is an owner prompt that expects an ordinary answer, and is not one of the five', () => {
  assert.equal(REMOTE_PROMPT[1], 'Can you come out to my shop and take a look?');
  assert.equal(REMOTE_PROMPT[2], 'answer');
  assert.deepEqual(REMOTE_FORBIDDEN_PHRASES, ['in person', 'come out', 'stop by', 'visit you', 'on site']);
  assert.deepEqual(REMOTE_EXPECTED_WORDS, ['online', 'video', 'virtual']);
  assert.ok(!OWNER_PROMPTS.some(([, prompt]) => prompt === REMOTE_PROMPT[1]));
});

test('evaluate: an online-only answer to the shop-visit question is clean', () => {
  assert.deepEqual(evaluate(REMOTE_PROMPT, 200, ownerBody(REMOTE_OK)), { problems: [], notes: [] });
  for (const word of ['online', 'video', 'virtual']) {
    assert.deepEqual(evaluate(REMOTE_PROMPT, 200, ownerBody(`We keep it ${word}, with a quick call first.`)), { problems: [], notes: [] }, word);
  }
});

test('evaluate: offering or implying an in-person visit is a hard failure, in any case or with a hyphen', () => {
  const replies = [
    ['Happy to meet in person and take a look.', 'in person'],
    ['Sure, we can come out to your shop next week.', 'come out'],
    ['We can stop by and see the setup.', 'stop by'],
    ['Someone can visit you at the shop.', 'visit you'],
    ['We can do an on site walkthrough.', 'on site'],
    ['We offer IN PERSON meetings.', 'in person'],
    ['We do in-person meetings around Woodstock.', 'in person'],
    ['A quick on-site look is possible.', 'on site'],
  ];
  for (const [reply, phrase] of replies) {
    const result = evaluate(REMOTE_PROMPT, 200, ownerBody(`${reply} It can also happen online.`));
    assert.ok(result.problems.some((p) => p.includes(`"${phrase}"`)), `${reply} -> ${JSON.stringify(result)}`);
  }
});

test('evaluate: a reply that never mentions online, video or virtual is only a note', () => {
  const result = evaluate(REMOTE_PROMPT, 200, ownerBody('We set everything up remotely, starting with a quick phone call.'));
  assert.deepEqual(result.problems, []);
  assert.equal(result.notes.length, 1);
  assert.ok(result.notes[0].includes('"online"') && result.notes[0].includes('"video"') && result.notes[0].includes('"virtual"'), result.notes[0]);
});

test('evaluate: the fallback or "unsure" is still a hard failure on the shop-visit question', () => {
  assert.ok(evaluate(REMOTE_PROMPT, 200, { ...ownerBody(FALLBACK_REPLY), intent: 'unsure' }).problems.length >= 1);
});

test('the phrase check is scoped to the prompts that ask for it, and ignores a missing reply', () => {
  const answer = evaluate(OWNER_PROMPTS[2], 200, ownerBody('Honestly, many owners want to meet in person, but we work online.'));
  assert.deepEqual(answer.problems, []);
  assert.deepEqual(checkForbiddenPhrases(undefined, REMOTE_FORBIDDEN_PHRASES), []);
  assert.deepEqual(checkForbiddenPhrases(REMOTE_OK, REMOTE_FORBIDDEN_PHRASES), []);
});

// --- the form asks for business, need and window now ----------------------------------

test('checkFormQuestions flags asking for the business name, what they need, or which window', () => {
  const phrases = [
    ["What's your business name?", 'business name'],
    ['And what is the business name?', 'business name'],
    ['Tell me what you need help with, and I will note it.', 'what you need'],
    ['Which window works best for you?', 'which window'],
    ['WHICH WINDOW would you like?', 'which window'],
  ];
  for (const [reply, needle] of phrases) {
    const problems = checkFormQuestions(reply);
    assert.equal(problems.length, 1, reply);
    assert.ok(problems[0].includes(needle), problems[0]);
    assert.ok(problems[0].includes('the form'), problems[0]);
  }
  assert.deepEqual(checkFormQuestions('Thanks, Dana! Check the box below and tap send, and someone will reach out during your window.'), []);
  assert.deepEqual(checkFormQuestions('What is the best phone number to reach you?'), []);
  assert.deepEqual(checkFormQuestions(undefined), []);
});

test('the phone-number message must not ask about the business, the need, or a window', () => {
  for (const reply of ["Thanks! What's your business name?", 'Thanks! Tell me what you need help with.', 'Thanks! Which window works for you?']) {
    const result = evaluate(PHONE_PROMPT, 200, collectingBody({ reply }));
    assert.ok(result.problems.some((p) => p.includes('the form')), `${reply} -> ${JSON.stringify(result)}`);
  }
  assert.deepEqual(evaluate(PHONE_PROMPT, 200, collectingBody({ reply: 'Thanks! What is your name?' })).problems, []);
});

test('that check is scoped: other prompts may mention a business name in an ordinary answer', () => {
  const answer = evaluate(OWNER_PROMPTS[1], 200, { reply: 'Once you are on a call we can look at your business name and setup.', intent: 'answer', offerCallback: false, readyToConfirm: false, lead: {} });
  assert.deepEqual(answer.problems, []);
});

test("the flow's last turn must not ask the form's questions, and the earlier turns only get a note", () => {
  const lastTurn = (reply) => [...FLOW_OK.slice(0, 2), step({ ...FLOW_OK[2].body, reply })];
  for (const reply of ['Thanks, Dana! What is your business name?', 'Thanks, Dana! What do you need help with? Tell me what you need.', 'Thanks, Dana! Which window works?']) {
    const { problems } = evaluateFlow(lastTurn(reply));
    assert.ok(problems.some((p) => p.startsWith('turn 3:') && p.includes('the form')), `${reply} -> ${JSON.stringify(problems)}`);
  }
  const early = [step({ ...FLOW_OK[0].body, reply: "Happy to set that up. What's your name and your business name?" }), FLOW_OK[1], FLOW_OK[2]];
  const result = evaluateFlow(early);
  assert.deepEqual(result.problems, []);
  assert.ok(result.notes.some((n) => n.startsWith('turn 1:') && n.includes('the form')), JSON.stringify(result));
});

// --- the phone-number message ----------------------------------------------------------

const collectingBody = (overrides = {}) => ({
  reply: 'Thanks! What is your name?',
  intent: 'collecting',
  offerCallback: false,
  readyToConfirm: false,
  lead: { name: '', phone: '7705550147', email: '', business: '', need: '', callbackWindow: '' },
  ...overrides,
});

test('the phone-number message is the production case: a number typed in the same breath as the request', () => {
  assert.match(PHONE_PROMPT[1], /770-555-0147/);
  assert.match(PHONE_PROMPT[1], /call me/i);
});

test('evaluate: the phone-number message must get intent "collecting" and lead.phone "7705550147"', () => {
  assert.deepEqual(evaluate(PHONE_PROMPT, 200, collectingBody()), { problems: [], notes: [] });
  const wrongIntent = evaluate(PHONE_PROMPT, 200, collectingBody({ intent: 'answer' }));
  assert.ok(wrongIntent.problems.some((p) => p.includes('collecting')), JSON.stringify(wrongIntent));
  const noPhone = evaluate(PHONE_PROMPT, 200, collectingBody({ lead: { name: '', phone: '', email: '', business: '', need: '', callbackWindow: '' } }));
  assert.ok(noPhone.problems.some((p) => p.includes('lead.phone')), JSON.stringify(noPhone));
  const unnormalized = evaluate(PHONE_PROMPT, 200, collectingBody({ lead: { name: '', phone: '770-555-0147', email: '', business: '', need: '', callbackWindow: '' } }));
  assert.ok(unnormalized.problems.some((p) => p.includes('lead.phone')), JSON.stringify(unnormalized));
  const missingLead = evaluate(PHONE_PROMPT, 200, { reply: 'Thanks!', intent: 'collecting' });
  assert.ok(missingLead.problems.some((p) => p.includes('lead.phone')), JSON.stringify(missingLead));
});

test('evaluate: the helper may repeat the number the visitor typed, and still may not refuse to take it', () => {
  assert.deepEqual(evaluate(PHONE_PROMPT, 200, collectingBody({ reply: 'Thanks, I have 770-555-0147. What is your name?' })).problems, []);
  // The production bug: refusing a number offered in chat. It is wrong on the intent and the lead, whatever it says.
  const refusal = evaluate(PHONE_PROMPT, 200, collectingBody({ reply: "Please don't share your phone number here in chat.", intent: 'answer', lead: { name: '', phone: '', email: '', business: '', need: '', callbackWindow: '' } }));
  assert.ok(refusal.problems.length >= 2, JSON.stringify(refusal));
});

// --- the three-turn collection flow ----------------------------------------------------

const step = (body) => ({ status: 200, body });
const FLOW_OK = [
  step({ ...collectingBody({ reply: 'Happy to set that up. What is your name?' }), lead: { name: '', phone: '', email: '', business: '', need: '', callbackWindow: '' } }),
  step(collectingBody({ reply: 'Thanks, Dana. What is the best phone number?', lead: { name: 'Dana Lee', phone: '', email: '', business: '', need: '', callbackWindow: '' } })),
  step(collectingBody({ reply: 'Thanks, Dana! Check the box below and tap send.', readyToConfirm: true, lead: { name: 'Dana Lee', phone: '7705550147', email: '', business: '', need: '', callbackWindow: '' } })),
];

test('the collection flow is the three visitor lines from the plan', () => {
  assert.deepEqual(COLLECTION_FLOW, ['can you have someone call me?', 'Dana Lee', '770-555-0147']);
});

test('evaluateFlow: a good three-turn flow is clean', () => {
  assert.deepEqual(evaluateFlow(FLOW_OK), { problems: [], notes: [] });
});

test('evaluateFlow: the last turn must be readyToConfirm with the name and normalized phone, and intent "collecting"', () => {
  const last = (patch) => [...FLOW_OK.slice(0, 2), step({ ...FLOW_OK[2].body, ...patch })];
  const failing = (flow, needle) => {
    const { problems } = evaluateFlow(flow);
    assert.ok(problems.some((p) => p.includes(needle)), `${needle} in ${JSON.stringify(problems)}`);
  };
  failing(last({ readyToConfirm: false }), 'readyToConfirm');
  failing(last({ intent: 'answer' }), 'collecting');
  failing(last({ lead: { ...FLOW_OK[2].body.lead, phone: '' } }), 'lead.phone');
  failing(last({ lead: { ...FLOW_OK[2].body.lead, phone: '(770) 555-0147' } }), 'lead.phone');
  failing(last({ lead: { ...FLOW_OK[2].body.lead, name: '' } }), 'lead.name');
  failing(last({ lead: { ...FLOW_OK[2].body.lead, name: 'Someone Else' } }), 'lead.name');
});

test('evaluateFlow: any reply in the flow breaks the same rules as every other reply', () => {
  const bad = [FLOW_OK[0], step({ ...FLOW_OK[1].body, reply: 'As an AI I have your name.' }), FLOW_OK[2]];
  assert.ok(evaluateFlow(bad).problems.some((p) => p.includes('as an AI')));
  const booked = [FLOW_OK[0], FLOW_OK[1], step({ ...FLOW_OK[2].body, reply: 'Great, you are booked for tomorrow.' })];
  assert.ok(evaluateFlow(booked).problems.some((problem) => problem.startsWith('turn 3:') && problem.includes('booked')));
  const failedStep = [FLOW_OK[0], { status: 503, body: { error: 'capacity' } }, FLOW_OK[2]];
  assert.ok(evaluateFlow(failedStep).problems.some((p) => p.includes('HTTP 503')));
});

test('evaluateFlow: the helper repeating the number back is fine; the first two turns are advisory', () => {
  const echoes = [FLOW_OK[0], FLOW_OK[1], step({ ...FLOW_OK[2].body, reply: 'Thanks, Dana! I have 770-555-0147. Check the box below and tap send.' })];
  assert.deepEqual(evaluateFlow(echoes).problems, []);
  const slowStart = [step({ ...FLOW_OK[0].body, intent: 'answer', reply: 'Sure, happy to help.' }), FLOW_OK[1], FLOW_OK[2]];
  const result = evaluateFlow(slowStart);
  assert.deepEqual(result.problems, []);
  assert.ok(result.notes.length >= 1, JSON.stringify(result));
});

// --- request bodies, arguments and addresses -------------------------------------------

test('chatRequestBody can carry a whole thread under one session id', () => {
  const thread = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'call me' }];
  const body = chatRequestBody(thread, DUMMY_TURNSTILE_TOKEN, 'fixed-session');
  assert.deepEqual(body.messages, thread);
  assert.equal(body.sessionId, 'fixed-session');
  assert.equal(body.turnstileToken, DUMMY_TURNSTILE_TOKEN);
});

test('parseArgs: defaults, a base URL, --only, and the environment variables', () => {
  const defaults = parseArgs([], {});
  assert.equal(defaults.baseUrl, 'http://localhost:8787');
  assert.deepEqual([...defaults.groups], ['base', 'owner', 'flow']);
  assert.equal(defaults.origin, 'http://localhost:3000');
  assert.equal(defaults.turnstileToken, DUMMY_TURNSTILE_TOKEN);

  const given = parseArgs(['https://example.workers.dev', '--only=owner,flow'], { PROBE_ORIGIN: 'https://thgservices.io', PROBE_TURNSTILE_TOKEN: 'abc' });
  assert.equal(given.baseUrl, 'https://example.workers.dev');
  assert.deepEqual([...given.groups], ['owner', 'flow']);
  assert.equal(given.origin, 'https://thgservices.io');
  assert.equal(given.turnstileToken, 'abc');

  assert.equal(parseArgs([], { BASE_URL: 'http://localhost:9999' }).baseUrl, 'http://localhost:9999');
  assert.equal(parseArgs([], { PROBE_TURNSTILE_TOKEN: '' }).turnstileToken, ''); // empty means send none
  assert.throws(() => parseArgs(['--only=base,bogus'], {}), /bogus/);
});

test('clientIpFor gives each group its own address on a local Worker, and none anywhere else', () => {
  const local = ['base', 'owner', 'flow'].map((group) => clientIpFor('http://localhost:8787', group, 'run-1'));
  assert.ok(local.every((ip) => /^198\.51\.\d{1,3}\.\d{1,3}$/.test(ip)), local.join());
  assert.equal(new Set(local).size, 3);
  assert.equal(clientIpFor('http://localhost:8787', 'owner', 'run-1'), local[1]); // stable within a run
  assert.notEqual(clientIpFor('http://localhost:8787', 'owner', 'run-2'), local[1]); // a new run gets new addresses
  assert.ok(clientIpFor('http://127.0.0.1:8787', 'base', 'run-1'));
  assert.equal(clientIpFor('https://thg-concierge.example.workers.dev', 'base', 'run-1'), undefined);
});

test('a rate-limit refusal is explained, because the full probe sends more than 20 messages', () => {
  const result = evaluate(PROMPTS[0], 429, { error: 'rate_limited' });
  assert.equal(result.problems.length, 1);
  assert.ok(result.problems[0].includes('--only'), result.problems[0]);
});
