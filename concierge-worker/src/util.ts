// Two helpers that several modules used to define for themselves.

/** A plain object, not null and not an array: what a parsed JSON body or a form field set should be. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Waits `ms` milliseconds; no timer at all for 0 or less, so tests that set no delay stay instant. */
export const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
