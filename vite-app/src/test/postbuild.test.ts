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
});
