// Text cleanup for everything a visitor can type. Applied server-side before
// validation, rate limiting, model calls and emails.

// Opening/closing tags, comments, doctype and processing instructions. Requiring a
// letter, "!" or "?" after "<" leaves "5 < 6" and "I <3 this" untouched. The body is
// [^<>]* (not [^>]*) on purpose: a tag body can never contain "<", so the pattern gives up
// at the next "<" instead of scanning to the end of the string. That keeps it linear on
// hostile input such as 100 KB of "<a<a<a...", which is quadratic with [^>]*.
const TAG = /<\/?[a-zA-Z!?][^<>]*>/g;

// C0 and C1 controls except tab/newline/carriage return, DEL, zero-width and BOM
// characters, and bidirectional override/isolate marks. Zero-width joiner/non-joiner
// (U+200C/U+200D) are kept so emoji sequences survive. Built from numeric ranges so
// no invisible characters live in this source file.
const CONTROL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200b], // zero-width space
  [0x2060, 0x2060], // word joiner
  [0xfeff, 0xfeff], // byte order mark / zero-width no-break space
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2066, 0x2069], // bidi isolates
];
const escapeCode = (code: number): string => `\\u${code.toString(16).padStart(4, '0')}`;
const CONTROL = new RegExp(
  `[${CONTROL_RANGES.map(([from, to]) =>
    from === to ? escapeCode(from) : `${escapeCode(from)}-${escapeCode(to)}`,
  ).join('')}]`,
  'g',
);

// CR, CRLF, and the Unicode line/paragraph separators, all normalized to LF. Built from
// char codes because a raw U+2028 inside a regex literal would end the line in JS source.
const LINE_BREAKS = new RegExp(
  `\\r\\n?|[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`,
  'g',
);

/** Removes HTML tags but keeps the text between them. Repeats so nested tags cannot reassemble. */
export const stripHtml = (input: string): string => {
  let output = input;
  for (let pass = 0; pass < 5; pass += 1) {
    const next = output.replace(TAG, '');
    if (next === output) break;
    output = next;
  }
  return output;
};

/** Removes control characters; keeps tab and newline and normalizes CRLF/CR/U+2028/U+2029 to LF. */
export const stripControl = (input: string): string =>
  input.replace(LINE_BREAKS, '\n').replace(CONTROL, '');

/** Control characters first (so "<scr\0ipt>" is still seen as a tag), then HTML, then trim. */
export const sanitizeText = (input: string): string => stripHtml(stripControl(input)).trim();

/** For values that end up in a header, subject line or single-line field. */
export const singleLine = (input: string): string => input.replace(/\s+/g, ' ').trim();

/** Truncates to `max` UTF-16 units without leaving half of a surrogate pair. */
export const clampLength = (input: string, max: number): string => {
  if (input.length <= max) return input;
  const clipped = input.slice(0, max);
  const last = clipped.charCodeAt(clipped.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? clipped.slice(0, -1) : clipped;
};
