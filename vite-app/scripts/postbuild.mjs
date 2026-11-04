// Runs after `vite build`. The site is a single-page app on GitHub Pages with
// no 404 fallback, so a direct hit on /from-estimate would be a 404. This
// writes dist/from-estimate/index.html, a copy of the built homepage, so that
// URL answers 200 and the SPA router then shows the estimate welcome band.
//
// Asset URLs in dist/index.html are absolute (vite base '/'), so the copy works
// from the subfolder unchanged. The copy is marked noindex so search engines
// keep the homepage as the one canonical page.
//
// Usage: node scripts/postbuild.mjs [distDir]   (default: ../dist)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOINDEX = '<meta name="robots" content="noindex">';

function fail(message) {
  console.error(`postbuild: ${message}`);
  process.exit(1);
}

const distDir = resolve(
  process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
);
const source = join(distDir, 'index.html');

if (!existsSync(source)) {
  fail(`${source} is missing. Run \`vite build\` first.`);
}

const html = readFileSync(source, 'utf8');

if (/<meta\s[^>]*name\s*=\s*["']robots["']/i.test(html)) {
  fail('dist/index.html already has a robots meta tag; it would contradict the noindex copy.');
}
if (!/<head(\s[^>]*)?>/i.test(html)) {
  fail('dist/index.html has no <head> to put the noindex meta tag in.');
}

const copy = html.replace(/<head(\s[^>]*)?>/i, (open) => `${open}\n    ${NOINDEX}`);

const targetDir = join(distDir, 'from-estimate');
mkdirSync(targetDir, { recursive: true });
writeFileSync(join(targetDir, 'index.html'), copy);

console.log(`postbuild: wrote ${join(targetDir, 'index.html')}`);
