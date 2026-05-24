// Generate sitemap.xml at build time so we don't need a server or a build-time
// crawl of every route. Routes are listed here so adding a new page is a one-
// liner in this file (single source of truth).
//
// Output: apps/marketing/dist/sitemap.xml.
// Run automatically as part of `pnpm --filter @bidstack/marketing build`.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'dist', 'sitemap.xml');
const BASE = 'https://bidstack.dev';
const today = new Date().toISOString().slice(0, 10);

// changefreq + priority kept deliberately simple. Google ignores these for
// most sites, but it helps less-sophisticated crawlers prioritize.
const routes = [
  { loc: '/', changefreq: 'weekly', priority: '1.0' },
  { loc: '/pricing', changefreq: 'monthly', priority: '0.9' },
  { loc: '/legal/terms', changefreq: 'yearly', priority: '0.3' },
  { loc: '/legal/privacy', changefreq: 'yearly', priority: '0.4' },
  { loc: '/legal/dpa', changefreq: 'yearly', priority: '0.3' },
  { loc: '/legal/security', changefreq: 'monthly', priority: '0.5' },
];

const body = routes
  .map(
    ({ loc, changefreq, priority }) =>
      `  <url>\n    <loc>${BASE}${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`,
  )
  .join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, xml, 'utf8');
console.log(`sitemap.xml written → ${OUT} (${routes.length} routes)`);
