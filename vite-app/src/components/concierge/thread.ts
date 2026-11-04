// Small pieces of the thread that the chat controller and the voice controller both need.

import { newId } from './storage';
import type { Message } from './types';

/** From the Nth user message on, /chat and /stt want a Turnstile token. */
export const TURNSTILE_AFTER_TURN = 10;

export const makeMessage = (
  role: Message['role'],
  content: string,
  extra: Partial<Message> = {}
): Message => ({
  id: newId(),
  role,
  content,
  at: new Date().toISOString(),
  ...extra,
});

/** Nothing has been said yet apart from (at most) the local greeting message. */
export const isFreshThread = (messages: readonly Message[]): boolean =>
  messages.length === 0 || (messages.length === 1 && messages[0].greeting === true);
