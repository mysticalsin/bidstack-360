// Org chart v18/v19 against the real API: HTML import preview, contact links and
// meeting recency. Uses only the fake fixture; local seed is
// /workspace/redo/seed-v18-orgchart.py (Example Corp + Example Inc). Skips when absent.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { test, expect } from './fixtures.js';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4010';
const EX = 'c1000000-0000-4000-8000-000000000201';
const EMPTY = 'c1000000-0000-4000-8000-000000000202';
const FIXTURE = fileURLToPath(new URL('../../api/src/org-chart/__fixtures__/people-map.fake.html', import.meta.url));
const H = { 'x-bidstack-e2e-role': 'admin' };
const node = (page: Page, name: string) => page.locator(`.react-flow__node:has([data-name="${name}"])`);

test.describe('org chart contacts and recency', () => {
  test.beforeEach(async ({ request }) => {
    const r = await request.get(`${API_URL}/api/v1/companies/${EX}/org-chart`, { headers: H });
    test.skip(!r.ok(), `org chart API unavailable (${r.status()})`);
    const body = (await r.json()) as { nodes: unknown[] };
    test.skip(body.nodes.length === 0, 'Example Corp org chart not seeded');
  });

  test('HTML import shows a dry-run preview with warnings and writes nothing until commit', async ({ page, request }) => {
    await page.goto(`/accounts/${EMPTY}/org-chart`);
    await page.getByTestId('orgchart-edit').click();
    await page.getByTestId('orgchart-html-input').setInputFiles({ name: 'example-people-map.html', mimeType: 'text/html', buffer: readFileSync(FIXTURE) });
    const preview = page.getByTestId('orgchart-csv-preview');
    await expect(preview).toContainText('dry run, nothing written yet');
    await expect(preview).toContainText("Found 12 people, 8 of them this account's own staff");
    const skipped = page.getByTestId('orgchart-import-skipped');
    await expect(skipped).toContainText('Skipped 4, not imported');
    await expect(skipped.locator('li[data-reason="system"]')).toHaveText('1 system or shared accounts');
    await expect(skipped.locator('li[data-reason="external"]')).toContainText('2 marked external');
    await expect(skipped.locator('li[data-reason="own_firm"]')).toHaveText('1 our own firm (Amaris)');
    await expect(preview).toContainText('8 to add');
    const rows = page.getByTestId('orgchart-import-preview').locator('tbody tr');
    await expect(rows).toHaveCount(8);
    await expect(rows.filter({ hasText: /Ivan Petrov|Jo Tanaka|Kim Laurent|Service Desk Bot/ })).toHaveCount(0);
    const warnings = page.getByTestId('orgchart-import-warnings');
    await expect(warnings).toContainText('Invalid email');
    await expect(warnings).not.toContainText(/Ivan Petrov|Jo Tanaka|Kim Laurent/);
    await preview.getByRole('button', { name: 'Cancel' }).click();
    const after = await request.get(`${API_URL}/api/v1/companies/${EMPTY}/org-chart`, { headers: H });
    expect(((await after.json()) as { nodes: unknown[] }).nodes).toHaveLength(0);
  });

  test('nodes carry a recency badge and contact icons', async ({ page }) => {
    await page.goto(`/accounts/${EX}/org-chart`);
    await expect(page.getByTestId('orgchart-node')).toHaveCount(8, { timeout: 15_000 });
    const ana = node(page, 'Ana Silva');
    await expect(ana.getByTestId('orgchart-recency')).toHaveText('Met recently');
    await expect(ana.getByTestId('orgchart-recency')).toHaveAttribute('title', /^Last met /);
    await expect(node(page, 'Dan Nguyen').getByTestId('orgchart-recency')).toHaveText(/^Met \d+ wk ago$/);
    // Matched by name only (no email on file), still counted as met.
    await expect(node(page, 'Elise Moreau').getByTestId('orgchart-recency')).toHaveText(/^Met \d+ wk ago$/);
    await expect(node(page, 'Bruno Costa').getByTestId('orgchart-recency')).toHaveCount(0);
    await expect(node(page, 'Hana Park').getByTestId('orgchart-recency')).toHaveCount(0);
    await expect(ana.locator('a[href="mailto:ana.silva@example.com"]')).toHaveCount(1);
    await expect(ana.locator('a[href^="tel:+55"]')).toHaveCount(1);
    await expect(ana.locator('a[href^="https://www.linkedin.com/in/"]')).toHaveAttribute('rel', /noopener/);
  });

  test('an unmet director is a senior gap on the chart, matching the server list', async ({ page, request }) => {
    await page.goto(`/accounts/${EX}/org-chart`);
    await expect(node(page, 'Gabriela Lima').getByTestId('orgchart-node')).toHaveAttribute('data-gap', 'true', { timeout: 15_000 });
    await expect(node(page, 'Hana Park').getByTestId('orgchart-node')).not.toHaveAttribute('data-gap', 'true');
    const cov = (await (await request.get(`${API_URL}/api/v1/companies/${EX}/org-chart/coverage`, { headers: H })).json()) as { unmetSenior: string[] };
    // The account card counts this same list (unit-tested with the page and the Sample).
    await expect(page.locator('[data-testid="orgchart-node"][data-gap="true"]')).toHaveCount(cov.unmetSenior.length);
  });

  test('side panel lists contacts, last meeting and profile', async ({ page }) => {
    await page.goto(`/accounts/${EX}/org-chart`);
    await node(page, 'Ana Silva').dispatchEvent('click');
    const panel = page.getByTestId('orgchart-panel');
    await expect(page.getByTestId('orgchart-panel-recency')).toContainText('Last met');
    await expect(panel.getByRole('link', { name: 'ana.silva@example.com' })).toHaveAttribute('href', 'mailto:ana.silva@example.com');
    const li = panel.getByRole('link', { name: 'LinkedIn profile' });
    await expect(li).toHaveAttribute('target', '_blank');
    await expect(li).toHaveAttribute('rel', /noopener/);
    await expect(panel).toContainText('Example City, Brazil');
  });
});
