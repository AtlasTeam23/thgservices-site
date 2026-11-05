import { Fragment, type ReactNode } from 'react';

// The scanner's `finding` and `fix` strings carry text taken from the scanned
// page, which is untrusted. They may contain <code> and <b>, and the server
// escapes page text as HTML entities. We never inject HTML: this turns the
// string into React nodes, builds <code> and <b> from a fixed allowlist, and
// leaves every other character (including any other tag) as plain text.

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
};

/** One pass, so "&amp;lt;" becomes "&lt;" and is never decoded a second time. */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:lt|gt|amp|quot|#39|#x27);/g, (m) => ENTITIES[m] ?? m);
}

const ALLOWED = /<(code|b)>([\s\S]*?)<\/\1>/gi;

export function renderSanitizedDetail(input: unknown): ReactNode {
  if (typeof input !== 'string' || input === '') return null;
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of input.matchAll(ALLOWED)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(decodeEntities(input.slice(last, start)));
    const inner = decodeEntities(match[2] ?? '');
    nodes.push(match[1]!.toLowerCase() === 'code' ? <code key={key++}>{inner}</code> : <b key={key++}>{inner}</b>);
    last = start + match[0].length;
  }
  if (last < input.length) nodes.push(decodeEntities(input.slice(last)));
  return (
    <>
      {nodes.map((n, i) => (
        <Fragment key={i}>{n}</Fragment>
      ))}
    </>
  );
}
