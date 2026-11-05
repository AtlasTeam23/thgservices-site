import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { decodeEntities, renderSanitizedDetail } from '../sanitize';

function html(input: string): string {
  const { container } = render(<p>{renderSanitizedDetail(input)}</p>);
  return container.innerHTML;
}

describe('renderSanitizedDetail', () => {
  it('allows <code> and <b> and nothing else', () => {
    expect(html('Title <code>Home</code> is <b>short</b>.')).toBe(
      '<p>Title <code>Home</code> is <b>short</b>.</p>'
    );
  });

  it('shows every other tag as plain text, never as an element', () => {
    const out = html('<img src=x onerror=alert(1)><script>alert(1)</script><a href="javascript:x">go</a><i>x</i>');
    const { container } = render(<p>{renderSanitizedDetail('<img src=x onerror=alert(1)><script>alert(1)</script><a href="javascript:x">go</a>')}</p>);
    expect(container.querySelector('img, script, a, i')).toBeNull();
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('&lt;script&gt;');
  });

  it('does not let attributes through on an allowed tag name', () => {
    const { container } = render(<p>{renderSanitizedDetail('<b onclick="x()">hi</b>')}</p>);
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toBe('<b onclick="x()">hi</b>');
  });

  it('turns the server\'s escaped page text back into characters, as text', () => {
    const { container } = render(
      <p>{renderSanitizedDetail('CTA found: <code>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more</code>')}</p>
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('code')?.textContent).toBe('<script>alert("x")</script> & more');
  });

  it('keeps tags inside <code> as text', () => {
    const { container } = render(<p>{renderSanitizedDetail('<code>a<b>b</b></code>')}</p>);
    expect(container.querySelector('code b')).toBeNull();
    expect(container.querySelector('code')?.textContent).toBe('a<b>b</b>');
  });

  it('decodes entities once only', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
  });

  it('returns nothing for empty or non-string input', () => {
    expect(renderSanitizedDetail('')).toBeNull();
    expect(renderSanitizedDetail(undefined)).toBeNull();
    expect(renderSanitizedDetail(42)).toBeNull();
  });
});
