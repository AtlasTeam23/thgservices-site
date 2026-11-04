import { HANDOFF, OFF_TOPIC_REPLY, PRICING_REPLY } from './copy';
import type { Reply } from './llm';
import { CALLBACK_WINDOWS, EMPTY_LEAD, normalizePhone, type CallbackWindow, type ChatMessage, type LeadFields } from './validation';

// The mock provider stands in for the model when LLM_PROVIDER is "mock" (local runs, tests, and the
// widget work). It is deterministic and needs no key, and it plays the part of the conversational
// helper closely enough to build against: it asks for contact details one step at a time, carries what
// it has learned forward in `lead` on every reply, and sets `readyToConfirm` once it has a name and a
// phone number. It is a script, not a model: it recognizes a handful of phrasings and nothing more.

// --- what the visitor has told us ----------------------------------------------------------

// A 10-digit US number, with an optional leading 1/+1, in the usual written forms.
const PHONE = /(?<!\d)(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)/g;
const EMAIL = /[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}/;
const NAME_INTRO = /\bmy name(?:'s| is)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/i;
const BUSINESS_INTRO = /\b(?:my business is|business name is|my company is|company name is)\s+(?:called\s+)?([^,.;!?\n]{2,60})/i;
const BARE_NAME = /^[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,3}$/;

// Words that trail a name in "my name is Dana Lee and my number is ..." and are not part of it.
const NAME_TAIL_WORDS = new Set(['and', 'my', 'is', 'number', 'phone', 'email', 'i', 'can', 'please', 'thanks', 'the', 'at', 'from', 'with', 'here', 'call', 'me', 'you', 'for', 'so', 'but', 'or']);
// Words that mean a short reply is an answer to something else, not a name.
const NOT_A_NAME = new Set([
  'yes', 'no', 'nope', 'yep', 'yeah', 'ok', 'okay', 'sure', 'please', 'thanks', 'thank', 'you', 'call', 'me', 'phone', 'number',
  'price', 'cost', 'help', 'what', 'how', 'why', 'who', 'when', 'where', 'do', 'does', 'can', 'could', 'would', 'hello', 'hi', 'hey',
  'maybe', 'not', 'now', 'good', 'sounds', 'fine', 'great', 'later', 'never', 'mind',
]);

const CURLY_APOSTROPHE = new RegExp(String.fromCharCode(0x2019), 'g');

const askedForName = (previous: ChatMessage | undefined): boolean =>
  previous?.role === 'assistant' && /your name/i.test(previous.content);

const nameFrom = (text: string, previous: ChatMessage | undefined): string | undefined => {
  const intro = NAME_INTRO.exec(text);
  if (intro?.[1]) {
    const words = intro[1].split(/\s+/);
    while (words.length > 0 && NAME_TAIL_WORDS.has(words.at(-1)!.toLowerCase())) words.pop();
    return words.length > 0 ? words.join(' ') : undefined;
  }
  const bare = text.trim();
  if (askedForName(previous) && bare.length <= 40 && BARE_NAME.test(bare)) {
    if (!bare.split(/\s+/).some((word) => NOT_A_NAME.has(word.toLowerCase()))) return bare;
  }
  return undefined;
};

const phoneFrom = (text: string): string | undefined => {
  let found: string | undefined;
  for (const match of text.matchAll(PHONE)) found = normalizePhone(match[0]) ?? found;
  return found;
};

const emailFrom = (text: string): string | undefined => EMAIL.exec(text)?.[0].replace(/[.,;:!?)]+$/, '');

const businessFrom = (text: string): string | undefined => {
  const raw = BUSINESS_INTRO.exec(text)?.[1];
  const business = raw?.split(/\s+and\s+(?:my|i|the|you|please|can)\b/i)[0]?.trim();
  return business ? business : undefined;
};

const windowFrom = (text: string): CallbackWindow | undefined => {
  if (/late afternoon/i.test(text)) return CALLBACK_WINDOWS[3];
  if (/afternoon/i.test(text)) return CALLBACK_WINDOWS[2];
  if (/midday|noon/i.test(text)) return CALLBACK_WINDOWS[1];
  if (/morning/i.test(text)) return CALLBACK_WINDOWS[0];
  return undefined;
};

type Found = Partial<Pick<LeadFields, 'name' | 'phone' | 'email' | 'business'>>;

/** The contact details in one visitor message (not the callback window; that depends on context). */
const detailsIn = (text: string, previous: ChatMessage | undefined): Found => {
  const found: Found = {};
  const name = nameFrom(text, previous);
  const phone = phoneFrom(text);
  const email = emailFrom(text);
  const business = businessFrom(text);
  if (name) found.name = name;
  if (phone) found.phone = phone;
  if (email) found.email = email;
  if (business) found.business = business;
  return found;
};

const normalizeQuotes = (text: string): string => text.replace(CURLY_APOSTROPHE, "'");

/** Everything the visitor has told us across the thread, the latest answer winning. */
const gather = (turns: ChatMessage[]): LeadFields => {
  const lead: LeadFields = { ...EMPTY_LEAD };
  let collecting = false;
  turns.forEach((turn, index) => {
    if (turn.role !== 'user') return;
    const text = normalizeQuotes(turn.content);
    const found = detailsIn(text, turns[index - 1]);
    Object.assign(lead, found);
    // A callback window only counts once details are being given, so "do you work mornings?" is just a question.
    const window = windowFrom(text);
    if (window && (collecting || Object.keys(found).length > 0)) lead.callbackWindow = window;
    if (Object.keys(found).length > 0) collecting = true;
  });
  return lead;
};

// --- what to say ---------------------------------------------------------------------------

const CALL_REQUEST = /\b(?:call me|call us|have (?:someone|somebody|david|the team|him|her) call|(?:someone|somebody) (?:to )?call|call (?:me )?back|ring me|callback)\b/i;

const firstName = (name: string): string => name.split(/\s+/)[0] ?? name;

/** The next thing to ask for, or the "check the box" line once there is a name and a phone number. */
const collectingStep = (lead: LeadFields): { reply: string; ready: boolean } => {
  if (lead.name && lead.phone) {
    return {
      reply: `Thanks, ${firstName(lead.name)}! Here's what I've got. Check the box below and tap send, and someone from our team will reach out during your window.`,
      ready: true,
    };
  }
  if (lead.name) return { reply: `Thanks, ${firstName(lead.name)}. What's the best phone number to reach you?`, ready: false };
  if (lead.phone) return { reply: "Thanks, I've got your number. What's your name?", ready: false };
  return { reply: "Happy to set that up. What's your name?", ready: false };
};

export const mockReply = (turns: ChatMessage[]): Reply => {
  const latestTurn = turns.findLast((turn) => turn.role === 'user');
  const latest = normalizeQuotes(latestTurn?.content ?? '');
  const lower = latest.toLowerCase();
  const latestIndex = latestTurn ? turns.lastIndexOf(latestTurn) : -1;

  const lead = gather(turns);
  const ready = Boolean(lead.name && lead.phone);
  const base = { offerCallback: false, readyToConfirm: ready, lead };

  // The visitor is giving details now if this message holds any, or names a callback window while
  // details are already being collected.
  const earlier = Object.values(gather(latestIndex > 0 ? turns.slice(0, latestIndex) : [])).some((value) => value !== '');
  const collectingNow =
    Object.keys(detailsIn(latest, turns[latestIndex - 1])).length > 0 || (earlier && windowFrom(latest) !== undefined);

  if (collectingNow) return { ...base, intent: 'collecting', reply: collectingStep(lead).reply };
  if (/\b(price|prices|pricing|cost|costs|much)\b/.test(lower)) return { ...base, intent: 'pricing', reply: PRICING_REPLY };
  if (/\b(person|human)\b/.test(lower)) return { ...base, intent: 'handoff', reply: HANDOFF };
  if (/\b(essay|weather|joke)\b/.test(lower)) return { ...base, intent: 'off_topic', reply: OFF_TOPIC_REPLY };
  if (CALL_REQUEST.test(latest)) return { ...base, intent: 'collecting', reply: collectingStep(lead).reply };
  if (/\b(call|callback|quote|demo)\b/.test(lower)) {
    return { ...base, offerCallback: true, intent: 'answer', reply: 'Happy to help with that. Want me to have someone call you?' };
  }
  return {
    ...base,
    intent: 'answer',
    reply: 'We help local businesses use AI to save time on the busywork, like missed calls, email, ads and bookkeeping.',
  };
};
