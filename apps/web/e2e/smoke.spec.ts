import { test, expect } from './fixtures.js';

test('dashboard loads with KPI cards', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/dashboard');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Dashboard' }),
  ).toBeVisible({
    timeout: 10_000,
  });
});

test('opportunities list renders seeded MAHLE row', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/opportunities');
  await expect(page.getByText(/MAHLE/i).first()).toBeVisible({ timeout: 10_000 });
});

test('opportunity detail shows Intel ribbon panels', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/opportunities');
  const firstLink = page.locator('a[href^="/opportunities/"]').first();
  await firstLink.click();
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.getByText(/win prediction|financial health|triggers/i).first()).toBeVisible({
    timeout: 10_000,
  });
});

test('command palette opens via Ctrl+K and navigates', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/dashboard');
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.type('pipeline');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/pipeline/);
});

test('agents page is reachable from product routes', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/agents');
  await expect(page.getByRole('heading', { level: 1, name: 'Agent Studio' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('heading', { level: 2, name: 'Agents', exact: true })).toBeVisible();
});

test('enterprise readiness surfaces are reachable in demo mode', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/dashboard');
  await expect(page.getByRole('status').filter({ hasText: /DEMO MODE/i })).toBeVisible({
    timeout: 10_000,
  });

  await gotoAndWait('/settings?tab=identity');
  await expect(page.getByRole('heading', { name: /Login identity/i })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();

  await gotoAndWait('/settings?tab=audit-log');
  await expect(page.getByRole('heading', { name: /Audit log/i }).first()).toBeVisible({
    timeout: 10_000,
  });

  await gotoAndWait('/settings?tab=data-import');
  await expect(page.getByText(/Choose a CSV/i)).toBeVisible({
    timeout: 10_000,
  });
});

test('dark mode toggle persists across reload', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/settings');
  const toggle = page.getByRole('button', { name: /theme|dark|light/i }).first();
  await expect(toggle).toBeVisible({ timeout: 5_000 });
  await toggle.click();
  const themeAfter = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.reload();
  await expect(page.locator('#main')).toBeVisible();
  const themeAfterReload = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'),
  );
  expect(themeAfterReload).toBe(themeAfter);
});
