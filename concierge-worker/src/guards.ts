// Cheap, model-free checks on what the visitor typed. They run after sanitizing and before
// any model call, so an obvious attack never costs a token.

import type { ChatMessage } from './validation';

export type GuardResult = { kind: 'ok' } | { kind: 'injection' } | { kind: 'abuse' };

// Case-insensitive prompt-injection patterns (contract section 2.3). Whitespace is \s+ and the
// gaps are [\s\S] so a line break cannot hide a phrase, which "." would let it do. A plain
// mention of "instructions" ("Do you give setup instructions?") does not match.
const INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore\s+(?:all|any|your|the|previous|prior|above)\s+[\s\S]*?instructions/i,
  // "show/reveal/print/repeat/output" only counts when the target is the helper's own prompt:
  // "system prompt", "your/the hidden/initial/original/previous/above instructions or rules",
  // or "instructions/rules above / you were given". "Show me the setup instructions" is a
  // normal request and must not be declined.
  new RegExp(
    String.raw`\b(?:show|reveal|print|repeat|output)\b[\s\S]{0,60}?(?:` +
      String.raw`\bsystem\s+prompt\b|` +
      String.raw`\b(?:your|the\s+system|the\s+hidden|the\s+initial|the\s+original|the\s+previous|the\s+above)\s+(?:instructions|rules)\b|` +
      String.raw`\b(?:instructions|rules)\s+(?:above|(?:that\s+)?you\s+(?:were|have\s+been|got|received)\s+given|you\s+received)` +
      String.raw`)`,
    'i',
  ),
  /\byou\s+are\s+now\b/i,
  /\bdeveloper\s+mode\b/i,
  /\bjailbreak\b/i,
  /\bpretend\s+(?:you\s+are|to\s+be)\b/i,
];

// A deliberately short, obvious list of profanity and slurs. Every term is anchored
// on word boundaries so ordinary words ("assess", "class", "Scunthorpe", "shiitake")
// never match. To change it, edit this array and the cases in test/guards.test.ts.
const ABUSE_PATTERNS: readonly RegExp[] = [
  /\bf+u+c+k+(ing|ed|er|ers|s)?\b/i,
  /\bmotherfuck\w*\b/i,
  /\b(bull)?s+h+i+t+(ty|head|s)?\b/i,
  /\bbitch(es|y)?\b/i,
  /\bassholes?\b/i,
  /\bcunts?\b/i,
  /\bn[i1]gg(er|a)s?\b/i,
  /\bf[a@]gg?[o0]ts?\b/i,
];

/**
 * Abuse outranks injection: someone swearing at the bot while also trying to
 * jailbreak it gets the chat ended rather than a polite decline.
 */
export const checkMessage = (text: string): GuardResult => {
  // NFKC folds full-width and other compatibility forms ("ＩＧＮＯＲＥ") to plain ASCII.
  const normalized = text.normalize('NFKC');
  if (ABUSE_PATTERNS.some((pattern) => pattern.test(normalized))) return { kind: 'abuse' };
  if (INJECTION_PATTERNS.some((pattern) => pattern.test(normalized))) return { kind: 'injection' };
  return { kind: 'ok' };
};

export type ScreenResult =
  | { kind: 'abuse' }
  /** The latest visitor message is an injection attempt: answer with the decline, make no model call. */
  | { kind: 'injection' }
  /** Safe to forward. `turns` is the thread with any earlier injected turns (and their replies) removed. */
  | { kind: 'ok'; turns: ChatMessage[] };

/**
 * Screens the turns that are about to be forwarded to the model.
 *
 * The client sends the whole thread and the server cannot tell an honest history from a forged
 * one, so every visitor turn is looked at, not just the latest. What happens on a match depends
 * on how serious it is and how recent:
 *
 * - Abuse (profanity or a slur) in ANY visitor turn ends the chat. That stays sticky.
 * - An injection attempt in the LATEST visitor message gets the off-topic decline and no model call.
 * - An injection attempt in an EARLIER turn does not spoil the rest of the conversation. That
 *   turn, and the assistant turn that followed it (normally our own decline), are dropped from
 *   what is forwarded, so the injected text never reaches the model, and the chat carries on.
 *
 * After removal the list still starts with a visitor turn and still ends with the latest one.
 * Assistant turns are not visitor input and are never matched. The input is not modified.
 */
export const screenTurns = (turns: readonly ChatMessage[]): ScreenResult => {
  const verdicts = turns.map((turn) => (turn.role === 'user' ? checkMessage(turn.content) : ({ kind: 'ok' } as GuardResult)));

  if (verdicts.some((verdict) => verdict.kind === 'abuse')) return { kind: 'abuse' };

  const latestUser = turns.findLastIndex((turn) => turn.role === 'user');
  if (latestUser !== -1 && verdicts[latestUser]?.kind === 'injection') return { kind: 'injection' };

  const kept: ChatMessage[] = [];
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i]!;
    if (verdicts[i]?.kind === 'injection') {
      if (turns[i + 1]?.role === 'assistant') i += 1; // the reply to the injected turn goes with it
      continue;
    }
    kept.push(turn);
  }

  // A stray assistant turn must not lead the list: the model API needs it to begin with the visitor.
  const firstUser = kept.findIndex((turn) => turn.role === 'user');
  return { kind: 'ok', turns: firstUser > 0 ? kept.slice(firstUser) : kept };
};
