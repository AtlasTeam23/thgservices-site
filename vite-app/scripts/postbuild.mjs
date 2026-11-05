// Runs after `vite build`. The site is a single-page app on GitHub Pages with
// no 404 fallback, so a direct hit on /from-estimate would be a 404. This
// writes dist/from-estimate/index.html, a copy of the built homepage, so that
// URL answers 200 and the SPA router then shows the estimate welcome band.
//
// Asset URLs in dist/index.html are absolute (vite base '/'), so the copy works
// from the subfolder unchanged. The copy is marked noindex so search engines
// keep the homepage as the one canonical page. Routes listed in INDEXABLE_ROUTES
// (the website checker) are the exception: own head tags, no noindex.
//
// Usage: node scripts/postbuild.mjs [distDir]   (default: ../dist)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOINDEX = '<meta name="robots" content="noindex">';

// Routes that get their own copy of the page but ARE meant to be indexed. Each
// one gets its own title, description, canonical and social tags in place of the
// homepage's, and no noindex.
// The checker is listed in public/sitemap.xml and linked from the nav, footer and
// Consulting section (CHECKER_LINKS_LIVE in src/lib/checker/config.ts).
const INDEXABLE_ROUTES = [
  {
    path: 'website-checker',
    title: 'Free Website Checker | THG AI Services',
    description:
      'Check your website for free. Get A to F grades for how easy it is to find in search and how well it turns visitors into customers, with a plain-language list of what to fix.',
    canonical: 'https://thgservices.io/website-checker/',
  },
];

const escapeAttr = (value) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Swap the homepage's head tags for a route's own (src/test/postbuild.test.ts runs the script). */
function withOwnHead(source, route) {
  const t = escapeAttr(route.title);
  const d = escapeAttr(route.description);
  const c = escapeAttr(route.canonical);
  const swap = (re, replacement) => {
    if (re.test(source)) {
      source = source.replace(re, () => replacement);
    } else {
      // The tag is missing (the homepage normally has them all): add it to <head>.
      source = source.replace(/<\/head>/i, () => `  ${replacement}\n  </head>`);
    }
  };
  swap(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(route.title)}</title>`);
  swap(/<meta\s+name="description"[^>]*>/i, `<meta name="description" content="${d}" />`);
  swap(/<link\s+rel="canonical"[^>]*>/i, `<link rel="canonical" href="${c}" />`);
  swap(/<meta\s+property="og:title"[^>]*>/i, `<meta property="og:title" content="${t}" />`);
  swap(/<meta\s+property="og:description"[^>]*>/i, `<meta property="og:description" content="${d}" />`);
  swap(/<meta\s+property="og:url"[^>]*>/i, `<meta property="og:url" content="${c}" />`);
  swap(/<meta\s+name="twitter:title"[^>]*>/i, `<meta name="twitter:title" content="${t}" />`);
  swap(/<meta\s+name="twitter:description"[^>]*>/i, `<meta name="twitter:description" content="${d}" />`);
  // The homepage's Organization JSON-LD describes the homepage, not this page.
  source = source.replace(/\s*<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/gi, '');
  return source;
}

const escapeHtml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

for (const route of INDEXABLE_ROUTES) {
  const dir = join(distDir, route.path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), withOwnHead(html, route));
  console.log(`postbuild: wrote ${join(dir, 'index.html')}`);
}
