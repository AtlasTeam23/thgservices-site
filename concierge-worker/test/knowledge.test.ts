import { describe, expect, it } from 'vitest';
import KNOWLEDGE from '../knowledge.md';

// knowledge.md is the only source of facts the helper may use, and it is read by the owner before
// every deploy. These checks pin the rules that keep it safe to ship: only figures that are on the
// site, no timelines or guarantees in the added sections, and short sections the owner can read in chat.

const BLAZE = "In some cases we've saved customers $80K a year while tripling return on ad spend.";

const sections = (): Map<string, string> => {
  const map = new Map<string, string>();
  for (const part of KNOWLEDGE.split(/^## /m).slice(1)) {
    const [title = '', ...body] = part.split('\n');
    map.set(title.trim(), body.join('\n').trim());
  }
  return map;
};
const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;

const ORIGINAL = ['Who we are', 'What we do, in plain words', 'Products', 'Contact', 'Things the helper must not claim'];
const ADDED = [
  'Who we work with',
  'How working with us goes',
  'After-hours calls',
  'The AI Website Concierge, for a business',
  'Frequently asked questions',
];

describe('knowledge.md', () => {
  it('starts with the provenance comment', () => {
    expect(KNOWLEDGE.split('\n')[0]).toBe(
      '<!-- Copied from thgservices.io source on 2026-11-03. Update when site copy changes; see README. -->',
    );
  });

  it('keeps every original section and adds the five new ones', () => {
    const titles = [...sections().keys()];
    for (const title of [...ORIGINAL, ...ADDED]) expect(titles, title).toContain(title);
  });

  it('stays under the 1,500-word budget', () => {
    expect(words(KNOWLEDGE)).toBeLessThan(1500); // was 1,400 before the full service list
  });

  it('keeps each added section short enough to read in chat', () => {
    for (const title of ADDED) {
      const body = sections().get(title) ?? '';
      expect(words(body), title).toBeGreaterThan(25);
      expect(words(body), title).toBeLessThanOrEqual(200); // the FAQ grew when the remote-only answers were added (was 170)
    }
  });

  it('holds no figure except the ones already on the site', () => {
    const allowedRemoved = KNOWLEDGE
      .replace(/<!--[\s\S]*?-->/g, '') // the provenance comment holds a date
      .replace(BLAZE, '')
      .replace(/\(866\) 519-7993/g, '')
      .replace(/\b(?:9|11|1|3)(?::00)?\s*(?:AM)?\s*[–-]\s*(?:11|1|3|5)(?::00)?\s*(?:AM|PM)\b/g, '') // the four callback windows
      .replace(/\b25 years\b/g, '')
      .replace(/\b15\+ years\b/g, '')
      .replace(/\b24\/7\b/g, '');
    expect(allowedRemoved).not.toMatch(/[0-9$]/);
  });

  it('still carries the site figures exactly as written, and the Blaze sentence marked as exact', () => {
    expect(KNOWLEDGE).toContain('25 years');
    expect(KNOWLEDGE).toContain('15+ years of AdWords expertise');
    expect(KNOWLEDGE).toContain('15+ years of AdWords experience');
    expect(KNOWLEDGE).toContain('24/7');
    expect(KNOWLEDGE.split(BLAZE)).toHaveLength(2); // exactly once
    expect(KNOWLEDGE).toContain(`${BLAZE} (exact wording required)`);
  });

  it('has no timeline or guarantee language in the added sections', () => {
    const forbidden = /\b(guarantee[ds]?|promise[ds]?|within|overnight|same[- ]day|next (?:day|morning|week)|by tomorrow|right away|immediately|instantly|always|never fail)\b/i;
    for (const title of ADDED) expect(sections().get(title) ?? '', title).not.toMatch(forbidden);
  });

  it('lists SEO, the website grade check and the rest of the service range, and does not deny them', () => {
    const body = sections().get('What we do, in plain words') ?? '';
    for (const word of ['Call handling', 'AI Website Concierge', 'Google Ads management', 'SEO:', 'Google Business Profile', 'Website grade check', 'search readiness', 'Website upgrades and new builds', 'landing pages', 'Analytics and tracking', 'Reviews and reputation', 'Email and inbox automation', 'QuickBooks or Xero', 'bookkeeping cleanup', '15+ years of AdWords experience']) {
      expect(body, word).toContain(word);
    }
    expect(KNOWLEDGE).not.toMatch(/don't list|do not list|not offer|isn't something we/i);
    expect(KNOWLEDGE).not.toMatch(/https?:\/\/[^\s)]*grade/i);
  });

  it('has no draft markers or notes to the owner left in it', () => {
    expect(KNOWLEDGE).not.toMatch(/\b(draft|todo|tbd|to confirm|david to|placeholder)\b/i);
  });

  it('avoids the jargon the helper is told never to say', () => {
    expect(KNOWLEDGE).not.toMatch(/\b(llm|api|token|tokens|model|models|agentic|prompt|chatbots?)\b/i);
  });

  it('names the kinds of business the helper should say it works with, restaurants included', () => {
    const body = sections().get('Who we work with') ?? '';
    for (const word of ['restaurants', 'retail', 'HVAC', 'plumbing', 'electrical', 'flooring', 'remodeling', 'painting', 'landscaping', 'law', 'accounting', 'insurance', 'real estate', 'health and wellness']) {
      expect(body, word).toContain(word);
    }
    expect(body).toMatch(/of all kinds|anyone else running a small business/);
  });

  it('describes how working together goes, where THG is, and how to start', () => {
    const how = sections().get('How working with us goes') ?? '';
    for (const word of ['quick call', 'online', 'video', 'support']) expect(how, word).toContain(word);
    const faq = sections().get('Frequently asked questions') ?? '';
    for (const word of ['technical', 'staff', 'QuickBooks', 'Xero', 'Woodstock', 'Cherokee County', 'metro Atlanta', '(866) 519-7993', 'examples']) expect(faq, word).toContain(word);
  });

  it('says THG AI Services works with clients remotely only, and never offers an in-person visit', () => {
    expect(KNOWLEDGE).not.toMatch(/\bin[\s-]person\b/i);
    const faq = sections().get('Frequently asked questions') ?? '';
    expect(faq).toContain('Everything with THG AI Services happens online, by phone and video, so there is nothing to travel to.');
    expect(faq).toContain('- Can you come out to my shop? For THG AI Services, no; it all happens online. We start with a quick call, then a video meeting, and we set things up remotely.');
  });

  it('describes the after-hours call handling and the concierge for a business', () => {
    const calls = sections().get('After-hours calls') ?? '';
    for (const word of ['name', 'number', 'voicemail', 'text or email']) expect(calls, word).toContain(word);
    const concierge = sections().get('The AI Website Concierge, for a business') ?? '';
    for (const word of ['same chat helper', 'callback', 'by email', 'monthly']) expect(concierge, word).toContain(word);
  });
});
