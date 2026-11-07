/**
 * Layout audit for the accounts section in light and dark at 1440x900,
 * 1024x768 and 390x844: no horizontal page overflow, no overlapping text, no
 * clipped text without an ellipsis and a title, and AA colour contrast (axe).
 *
 * Text under 12px is a ratchet, not a zero gate: shared primitives (Badge,
 * SortableHeader, the global table header and KPI styles) still render 10-11px
 * labels across every section. The per-route count may only go down; refresh
 * the ceiling with AUDIT_WRITE_SMALL_TEXT=1 after lowering it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '../fixtures.js';
import {
  AUDIT_THEMES,
  AUDIT_VIEWPORTS,
  contrastIssues,
  formatIssues,
  geometryIssues,
  pinTheme,
  settle,
  type LayoutIssue,
} from './accounts-layout.js';

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:4010';
const CEILING_FILE = resolve(process.cwd(), 'e2e/audit/accounts-small-text-ceiling.json');
const WRITE_CEILING = process.env.AUDIT_WRITE_SMALL_TEXT === '1';

function readCeiling(): Record<string, number> {
  return existsSync(CEILING_FILE)
    ? (JSON.parse(readFileSync(CEILING_FILE, 'utf8')) as Record<string, number>)
    : {};
}

test.describe.configure({ retries: 0, timeout: 300_000 });

let companyId = '';
let contactId = '';
let leadId = '';

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  const first = async (path: string) =>
    ((await (await request.get(`${API}${path}`)).json()) as { items: Array<{ id: string }> }).items[0]
      ?.id ?? '';
  companyId = await first('/api/companies?limit=1');
  contactId = await first('/api/contacts?limit=1');
  leadId = await first('/api/leads?limit=1');
});

const ROUTES: Array<{ name: string; path: () => string }> = [
  { name: 'accounts', path: () => '/accounts' },
  { name: 'accounts-key', path: () => '/accounts?view=key' },
  { name: 'accounts-top', path: () => '/accounts?view=top' },
  { name: 'org-chart', path: () => `/accounts/${companyId}/org-chart` },
  { name: 'companies', path: () => '/companies' },
  { name: 'company-detail', path: () => `/companies/${companyId}` },
  { name: 'contacts', path: () => '/contacts' },
  { name: 'contact-detail', path: () => `/contacts/${contactId}` },
  { name: 'leads', path: () => '/leads' },
  { name: 'lead-new', path: () => '/leads/new' },
  { name: 'lead-detail', path: () => `/leads/${leadId}` },
  { name: 'kam', path: () => '/kam' },
  { name: 'territories', path: () => '/territories' },
  { name: 'search', path: () => '/search?q=north' },
  { name: 'workload', path: () => '/workload' },
];

for (const theme of AUDIT_THEMES) {
  for (const route of ROUTES) {
    test(`layout audit ${route.name} (${theme})`, async ({ page }) => {
      test.setTimeout(300_000);
      await pinTheme(page, theme);
      const found: string[] = [];
      const small: string[] = [];
      const ceiling = readCeiling();
      const counts: Record<string, number> = {};
      for (const vp of AUDIT_VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(route.path(), { waitUntil: 'load' });
        await settle(page);
        const issues: LayoutIssue[] = [
          ...(await geometryIssues(page)),
          ...(await contrastIssues(page)),
        ];
        const tiny = issues.filter((i) => i.kind === 'text-under-12px');
        const hard = issues.filter((i) => i.kind !== 'text-under-12px');
        const key = `${route.name}|${theme}|${vp.name}`;
        counts[key] = tiny.length;
        if (hard.length > 0) found.push(formatIssues(`${route.path()} @${vp.name}`, hard));
        if (tiny.length > 0) small.push(formatIssues(`${route.path()} @${vp.name}`, tiny));
        const limit = ceiling[key];
        if (!WRITE_CEILING && limit !== undefined && tiny.length > limit) {
          found.push(`${key}: ${tiny.length} text-under-12px runs, ceiling ${limit}`);
        }
      }
      if (WRITE_CEILING) writeFileSync(CEILING_FILE, `${JSON.stringify({ ...readCeiling(), ...counts }, null, 2)}\n`);
      await test.info().attach(`layout-${route.name}-${theme}.txt`, {
        body: [...found, ...small].join('\n\n') || 'clean',
        contentType: 'text/plain',
      });
      expect(found, found.join('\n\n')).toEqual([]);
    });
  }
}
