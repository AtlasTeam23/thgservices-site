import { describe, expect, it } from 'vitest';
import { clampLength, sanitizeText, singleLine, stripControl, stripHtml } from '../src/sanitize';

describe('stripHtml', () => {
  it('removes tags but keeps the text between them', () => {
    expect(stripHtml('<b>hi</b><script>x</script>')).toBe('hix');
  });

  it('leaves plain text, comparisons and "<3" alone', () => {
    expect(stripHtml('plain text')).toBe('plain text');
    expect(stripHtml('5 < 6 and 7 > 3')).toBe('5 < 6 and 7 > 3');
    expect(stripHtml('I <3 this')).toBe('I <3 this');
  });

  it('removes attributes, comments and doctype-style tags', () => {
    expect(stripHtml('a <img src=x onerror=alert(1)> b')).toBe('a  b');
    expect(stripHtml('<!-- hidden -->visible')).toBe('visible');
    expect(stripHtml('<!DOCTYPE html>ok')).toBe('ok');
  });

  it('cannot be defeated by nesting a tag inside a tag', () => {
    expect(stripHtml('<<b>script>alert(1)</b>')).toBe('alert(1)');
    // "<scr" is not a complete tag, "<b>" is: once it goes, "<script>" is left and the next pass removes it.
    expect(stripHtml('<scr<b>ipt>x')).toBe('x');
    expect(stripHtml('<scr<b>ipt>x')).not.toMatch(/<\s*\/?\s*[a-z]/i);
  });
});

describe('stripHtml cost', () => {
  // Hostile input is quadratic for a tag pattern that can run on to the end of the string.
  // These sizes would take many seconds with `<[^>]*>`; the linear pattern takes a few ms.
  const timed = (work: () => unknown): number => {
    const started = performance.now();
    work();
    return performance.now() - started;
  };

  it.each([
    ['unclosed tags', '<a'.repeat(100_000)],
    ['unclosed tags with attributes', '<a href=x '.repeat(20_000)],
    ['an opening bracket at every position', '<'.repeat(200_000)],
    ['nested openers', '<<<<<<<<b>'.repeat(20_000)],
    ['comments that never end', '<!--'.repeat(50_000)],
  ])('finishes %s in well under 100 ms', (_label, payload) => {
    expect(timed(() => stripHtml(payload))).toBeLessThan(100);
  });

  it('scales roughly linearly with input size', () => {
    const small = Math.max(timed(() => stripHtml('<a'.repeat(25_000))), 1);
    const large = timed(() => stripHtml('<a'.repeat(200_000))); // 8x the input
    expect(large / small).toBeLessThan(40); // quadratic growth would be ~64x
  });

  it('still strips real tags next to hostile text', () => {
    expect(stripHtml(`<a<a<a<a <b>bold</b> done`)).toBe('<a<a<a<a bold done');
  });
});

describe('stripControl', () => {
  it('removes C0/C1 control characters, DEL, bidi overrides and zero-width spaces', () => {
    // 0x202e = bidi override, 0x200b = zero-width space, 0xfeff = BOM
    const codes = [0, 7, 0x1f, 0x7f, 0x85, 0x202e, 0x200b, 0xfeff];
    const letters = 'abcdefghi';
    const dirty = [...letters].map((letter, i) => letter + (i < codes.length ? String.fromCharCode(codes[i]!) : '')).join('');
    expect(stripControl(dirty)).toBe('abcdefghi');
  });

  it('keeps newlines and tabs, and normalizes CRLF and lone CR to LF', () => {
    expect(stripControl('a\tb\nc\r\nd\re')).toBe('a\tb\nc\nd\ne');
  });

  it('keeps zero-width joiners so emoji sequences survive', () => {
    const family = String.fromCodePoint(0x1f469, 0x200d, 0x1f4bb);
    expect(stripControl(family)).toBe(family);
  });
});

describe('sanitizeText', () => {
  it('strips control characters first so a split tag is still caught', () => {
    expect(sanitizeText('<scr\u0000ipt>x</scr\u0000ipt>')).toBe('x');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeText('  hello \n')).toBe('hello');
  });
});

describe('singleLine', () => {
  it('collapses every run of whitespace, newlines included, to one space', () => {
    expect(singleLine('Jane\r\nDoe\t  Smith\n')).toBe('Jane Doe Smith');
  });
});

describe('clampLength', () => {
  it('truncates to the maximum length', () => {
    expect(clampLength('abcdef', 3)).toBe('abc');
    expect(clampLength('abc', 3)).toBe('abc');
  });

  it('does not leave half of a surrogate pair behind', () => {
    // The emoji is two UTF-16 units, so index 2 lands on its high surrogate.
    const clamped = clampLength(`ab${String.fromCodePoint(0x1f600)}cd`, 3);
    expect(clamped).toBe('ab');
  });
});
