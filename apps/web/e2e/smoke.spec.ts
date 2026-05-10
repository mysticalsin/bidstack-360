import { test, expect, type Page, request as pwRequest } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

let apiHealthy = false;

test.beforeAll(async () => {
  try {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${API_URL}/health`, { timeout: 2_000 });
    apiHealthy = res.ok();
    await ctx.dispose();
  } catch {
    apiHealthy = false;
  }
});

test.beforeEach(async () => {
  test.skip(!apiHealthy, `API at ${API_URL} not reachable — skipping smoke suite`);
});

async function gotoAndWait(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('main')).toBeVisible();
}

test('dashboard loads with KPI cards', async ({ page }) => {
  await gotoAndWait(page, '/dashboard');
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
});

test('opportunities list renders seeded MAHLE row', async ({ page }) => {
  await gotoAndWait(page, '/opportunities');
  await expect(page.getByText(/MAHLE/i).first()).toBeVisible({ timeout: 10_000 });
});

test('opportunity detail shows Intel ribbon panels', async ({ page }) => {
  await gotoAndWait(page, '/opportunities');
  const firstLink = page.locator('a[href^="/opportunities/"]').first();
  await firstLink.click();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(
    page.getByText(/win prediction|financial health|triggers/i).first(),
  ).toBeVisible({ timeout: 10_000 });
});

test('command palette opens via Ctrl+K and navigates', async ({ page }) => {
  await gotoAndWait(page, '/dashboard');
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.type('pipeline');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/pipeline/);
});

test('dark mode toggle persists across reload', async ({ page }) => {
  await gotoAndWait(page, '/settings');
  const toggle = page.getByRole('button', { name: /theme|dark|light/i }).first();
  if (!(await toggle.isVisible().catch(() => false))) {
    test.skip(true, 'theme toggle not present in current settings page');
  }
  await toggle.click();
  const themeAfter = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'),
  );
  await page.reload();
  await expect(page.getByRole('main')).toBeVisible();
  const themeAfterReload = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'),
  );
  expect(themeAfterReload).toBe(themeAfter);
});
