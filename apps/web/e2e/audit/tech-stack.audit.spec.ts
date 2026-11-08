/**
 * Click and layout audit for the technology stack (slice 16).
 *
 * Click audit: on the account page wall (/companies/:id), the cockpit card
 * (/accounts/:accountId) and the accounts list, every evidence chip opens its
 * popover and closes on Escape, the refresh control runs the open data lanes
 * and the coverage line names the lanes, all without a console error, a page
 * error or an unexpected API 4xx/5xx.
 *
 * Layout audit: light and dark at 1440x900, 1024x768 and 390x844, inside the
 * tech surfaces: no overlapping text, no horizontal page overflow, no clipped
 * text without an ellipsis and a title, no text under 12px, AA contrast.
 *
 * Linux screenshot baselines, if any are added later, come from CI captures.
 */
import type { Page, Response } from '@playwright/test';

import { expect, test } from '../fixtures.js';
import {
  AUDIT_THEMES,
  AUDIT_VIEWPORTS,
  formatIssues,
  pinTheme,
  settle,
  techContrastIssues,
  techGeometryIssues,
  type LayoutIssue,
} from './tech-stack-layout.js';

// Refreshes write to the seed and the matrix runs axe 18 times: opt in, never in the sharded suite.
test.skip(process.env.E2E_AUDIT !== '1', 'set E2E_AUDIT=1 to run the tech stack audits');
test.describe.configure({ retries: 0, timeout: 300_000 });

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:4010';
/** DNB Bank from the main seed; it carries a sample open data stack. */
const DNB = 'c0000000-0000-4000-8000-000000000008';

const ROUTES = [
  { name: 'company-detail', path: `/companies/${DNB}`, region: '[data-testid="tech-stack-wall"]' },
  { name: 'account-cockpit', path: `/accounts/${DNB}`, region: '[role="region"][aria-label="Technical Stack Overview"]' },
  { name: 'accounts-list', path: '/accounts', region: '[data-testid="account-card-tech"]' },
] as const;

type Watch = { problems: string[] };

function watch(page: Page): Watch {
  const w: Watch = { problems: [] };
  page.on('pageerror', (err) => w.problems.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Missing brand logos 404 on the logo proxy by design and fall back to a monogram.
    if (text.startsWith('Failed to load resource')) return;
    w.problems.push(`console: ${text.slice(0, 200)}`);
  });
  page.on('response', (res: Response) => {
    const url = res.url();
    if (!url.startsWith(API) || res.status() < 400) return;
    if (/\/api\/(v1\/)?logo/.test(url) && res.status() === 404) return;
    w.problems.push(`${res.request().method()} ${url.replace(API, '')} -> ${res.status()}`);
  });
  return w;
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'load' });
  await settle(page);
}

test('seed gives DNB a sample stack with per lane coverage', async ({ request }) => {
  const res = await request.get(`${API}/api/crm/companies/${DNB}/technical-stack`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { coverage: { sample: boolean; lanes: Array<{ lane: string; status: string; count: number }> } | null };
  expect(body.coverage?.sample).toBe(true);
  expect(body.coverage?.lanes.map((l) => l.lane)).toEqual(['dns', 'ct', 'web', 'jobs', 'github']);
});

test('click audit company detail: every evidence chip opens and closes its popover', async ({ page }) => {
  const w = watch(page);
  await open(page, `/companies/${DNB}`);
  const wall = page.getByTestId('tech-stack-wall');
  await expect(wall).toBeVisible();
  await expect(page.getByTestId('tech-coverage-line').first()).toContainText('Coverage:');
  await expect(page.getByTestId('tech-coverage-line').first()).toContainText('Sample');
  const chips = wall.getByRole('button', { name: /evidence,/ });
  const count = await chips.count();
  expect(count).toBeGreaterThan(3);
  for (let i = 0; i < count; i++) {
    const chip = chips.nth(i);
    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(/^Sample/).last()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.move(0, 0);
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
  }
  expect(w.problems).toEqual([]);
});

test('click audit cockpit: pull sources runs the open data lanes and reports them', async ({ page }) => {
  const w = watch(page);
  await open(page, `/accounts/${DNB}`);
  const card = page.getByRole('region', { name: 'Technical Stack Overview' });
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  const refreshed = page.waitForResponse(
    (r) => /\/technical-stack\/refresh$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await card.getByRole('button', { name: /Pull technical stack/ }).click();
  const res = await refreshed;
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { providers: Array<{ id: string; lanes?: unknown[] }> };
  expect(body.providers.find((p) => p.id === 'open_data')?.lanes).toHaveLength(5);
  expect(w.problems).toEqual([]);
});

test('click audit accounts list: tech logos name every technology in the tooltip', async ({ page }) => {
  const w = watch(page);
  await open(page, '/accounts');
  const tech = page.getByTestId('account-card-tech').filter({ has: page.locator('[data-tech-name]') }).first();
  await expect(tech).toBeVisible();
  expect(await tech.locator('[data-tech-name]').count()).toBeLessThanOrEqual(3);
  expect((await tech.getAttribute('title'))?.length ?? 0).toBeGreaterThan(0);
  expect(w.problems).toEqual([]);
});

for (const theme of AUDIT_THEMES) {
  for (const route of ROUTES) {
    test(`layout audit ${route.name} (${theme})`, async ({ page }) => {
      await pinTheme(page, theme);
      const found: string[] = [];
      for (const vp of AUDIT_VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await open(page, route.path);
        const region = page.locator(route.region).first();
        await region.scrollIntoViewIfNeeded().catch(() => undefined);
        await expect(region, `${route.region} on ${route.path}`).toBeVisible();
        const issues: LayoutIssue[] = [...(await techGeometryIssues(page)), ...(await techContrastIssues(page))];
        if (issues.length > 0) found.push(formatIssues(`${route.path} @${vp.name} ${theme}`, issues));
      }
      await test.info().attach(`tech-layout-${route.name}-${theme}.txt`, { body: found.join('\n\n') || 'clean', contentType: 'text/plain' });
      expect(found, found.join('\n\n')).toEqual([]);
    });
  }
}
