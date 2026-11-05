/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'postbuild.mjs');

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>THG AI Services</title>
    <link rel="canonical" href="https://thgservices.io/" />
    <script type="module" crossorigin src="/assets/index-AbC123.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-XyZ789.css">
  </head>
  <body><div id="root"></div></body>
</html>
`;

function run(dist: string) {
  return spawnSync(process.execPath, [SCRIPT, dist], { encoding: 'utf8' });
}

describe('scripts/postbuild.mjs', () => {
  let dist: string;

  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'thg-postbuild-'));
  });

  afterEach(() => {
    rmSync(dist, { recursive: true, force: true });
  });

  it('copies dist/index.html to dist/from-estimate/index.html with a noindex meta in <head>', () => {
    writeFileSync(join(dist, 'index.html'), INDEX_HTML);
    const result = run(dist);
    expect(result.status).toBe(0);

    const copy = readFileSync(join(dist, 'from-estimate', 'index.html'), 'utf8');
    expect(copy).toContain('<meta name="robots" content="noindex">');
    const head = copy.slice(copy.indexOf('<head>'), copy.indexOf('</head>'));
    expect(head).toContain('<meta name="robots" content="noindex">');
    // Exactly one, and nothing else about the page changed.
    expect(copy.match(/name="robots"/g)).toHaveLength(1);
    expect(copy.replace(/\s*<meta name="robots" content="noindex">/, '')).toBe(INDEX_HTML);
  });

  it('keeps the same absolute asset references as dist/index.html', () => {
    writeFileSync(join(dist, 'index.html'), INDEX_HTML);
    run(dist);
    const copy = readFileSync(join(dist, 'from-estimate', 'index.html'), 'utf8');
    expect(copy).toContain('src="/assets/index-AbC123.js"');
    expect(copy).toContain('href="/assets/index-XyZ789.css"');
  });

  it('leaves dist/index.html itself untouched (the homepage stays indexable)', () => {
    writeFileSync(join(dist, 'index.html'), INDEX_HTML);
    run(dist);
    expect(readFileSync(join(dist, 'index.html'), 'utf8')).toBe(INDEX_HTML);
  });

  it('is safe to run twice', () => {
    writeFileSync(join(dist, 'index.html'), INDEX_HTML);
    expect(run(dist).status).toBe(0);
    expect(run(dist).status).toBe(0);
    const copy = readFileSync(join(dist, 'from-estimate', 'index.html'), 'utf8');
    expect(copy.match(/name="robots"/g)).toHaveLength(1);
  });

  it('fails loudly when dist/index.html is missing, and creates nothing', () => {
    const result = run(dist);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/index\.html/);
    expect(existsSync(join(dist, 'from-estimate'))).toBe(false);
  });

  it('fails loudly when dist itself is missing', () => {
    const result = run(join(dist, 'nope'));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/index\.html/);
  });

  it('fails loudly when index.html has no <head> to put the meta in', () => {
    writeFileSync(join(dist, 'index.html'), '<html><body></body></html>');
    const result = run(dist);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/<head>/);
    expect(existsSync(join(dist, 'from-estimate', 'index.html'))).toBe(false);
  });

  it('fails loudly when index.html already has a robots meta (the two would contradict)', () => {
    writeFileSync(
      join(dist, 'index.html'),
      INDEX_HTML.replace('<title>', '<meta name="robots" content="index,follow" />\n    <title>')
    );
    const result = run(dist);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/robots/);
  });

  it('overwrites a stale from-estimate/index.html', () => {
    writeFileSync(join(dist, 'index.html'), INDEX_HTML);
    mkdirSync(join(dist, 'from-estimate'));
    writeFileSync(join(dist, 'from-estimate', 'index.html'), 'stale');
    expect(run(dist).status).toBe(0);
    expect(readFileSync(join(dist, 'from-estimate', 'index.html'), 'utf8')).not.toBe('stale');
  });

  describe('the website checker page', () => {
    const FULL_INDEX = INDEX_HTML.replace(
      '<title>THG AI Services</title>',
      `<title>THG AI Services</title>
    <meta name="description" content="Home description" />
    <meta property="og:title" content="THG AI Services" />
    <meta property="og:description" content="Home og" />
    <meta property="og:url" content="https://thgservices.io/" />
    <meta name="twitter:title" content="THG AI Services" />
    <meta name="twitter:description" content="Home twitter" />`
    );

    const built = () => {
      writeFileSync(join(dist, 'index.html'), FULL_INDEX);
      expect(run(dist).status).toBe(0);
      return readFileSync(join(dist, 'website-checker', 'index.html'), 'utf8');
    };

    it('writes website-checker/index.html with its own title, description, canonical and Open Graph tags', () => {
      const page = built();
      expect(page).toContain('<title>Free Website Checker | THG AI Services</title>');
      expect(page).toMatch(/<meta name="description" content="[^"]{60,}"/);
      expect(page).not.toContain('Home description');
      expect(page).toContain('<link rel="canonical" href="https://thgservices.io/website-checker/" />');
      expect(page).not.toContain('<link rel="canonical" href="https://thgservices.io/" />');
      expect(page).toContain('<meta property="og:title" content="Free Website Checker | THG AI Services" />');
      expect(page).toContain('<meta property="og:url" content="https://thgservices.io/website-checker/" />');
      expect(page).toContain('<meta name="twitter:title" content="Free Website Checker | THG AI Services" />');
      expect(page).not.toContain('Home og');
    });

    it('has NO noindex (it is meant to be found), while from-estimate still has one', () => {
      const page = built();
      expect(page).not.toMatch(/noindex/i);
      expect(page).not.toMatch(/name="robots"/i);
      expect(readFileSync(join(dist, 'from-estimate', 'index.html'), 'utf8')).toContain('noindex');
    });

    it('keeps the homepage\'s asset references and leaves dist/index.html untouched', () => {
      const page = built();
      expect(page).toContain('src="/assets/index-AbC123.js"');
      expect(readFileSync(join(dist, 'index.html'), 'utf8')).toBe(FULL_INDEX);
    });

    it('still works when the homepage lacks some of those tags (it adds them to <head>)', () => {
      writeFileSync(join(dist, 'index.html'), INDEX_HTML);
      expect(run(dist).status).toBe(0);
      const page = readFileSync(join(dist, 'website-checker', 'index.html'), 'utf8');
      expect(page).toContain('<title>Free Website Checker | THG AI Services</title>');
      expect(page).toContain('<meta name="description" content="');
      expect(page).toContain('og:url');
      expect(page).not.toMatch(/noindex/i);
    });

    it('is NOT in the sitemap during the hidden launch (it returns with the public links)', () => {
      const sitemap = readFileSync(join(import.meta.dirname, '..', '..', 'public', 'sitemap.xml'), 'utf8');
      expect(sitemap).not.toContain('website-checker');
    });

    it("drops the homepage's JSON-LD from the checker page only", () => {
      const withLd = INDEX_HTML.replace(
        '</head>',
        '<script type="application/ld+json">{"@type":"Organization"}</script>\n  </head>'
      );
      writeFileSync(join(dist, 'index.html'), withLd);
      expect(run(dist).status).toBe(0);
      expect(readFileSync(join(dist, 'website-checker', 'index.html'), 'utf8')).not.toContain('ld+json');
      expect(readFileSync(join(dist, 'index.html'), 'utf8')).toContain('ld+json');
      expect(readFileSync(join(dist, 'from-estimate', 'index.html'), 'utf8')).toContain('ld+json');
    });
  });
});
