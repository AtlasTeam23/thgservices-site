// Small pieces of the thread that the chat controller and the voice controller both need.

import { newId } from './storage';
import type { Message } from './types';

/** From the Nth user message on, /chat wants a Turnstile token. */
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
