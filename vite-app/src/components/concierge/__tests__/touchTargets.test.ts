import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// jsdom does no layout, so the 44px touch-target rules are checked in the stylesheet itself.
const css = readFileSync(join(__dirname, '..', 'concierge.css'), 'utf8');

const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};

describe('touch targets', () => {
  it('keeps the consent checkbox row at least 44px tall', () => {
    expect(rule('.thg-cc-field label.thg-cc-check')).toMatch(/min-height:\s*44px/);
  });
});
