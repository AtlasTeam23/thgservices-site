import type { CheckStatus, Letter } from './types';

const LETTERS: readonly Letter[] = ['A', 'B', 'C', 'D', 'F'];

/** A letter we know how to color, or null (the server's word is never trusted as a CSS name). */
export const safeLetter = (g: string | undefined | null): Letter | null =>
  LETTERS.includes(g as Letter) ? (g as Letter) : null;

export const asStatus = (s: unknown): CheckStatus => (s === 'pass' || s === 'warn' ? s : 'fail');
