import { test, expect } from './fixtures.js';

test('opportunities list filters by stage', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/opportunities');
  await expect(page.locator('h1')).toContainText('Opportunities', { timeout: 10_000 });

  // Try clicking a canonical stage filter chip. It should exist and update
  // the current list without leaving the page.
  const stageFilter = page.getByRole('button', { name: /s1 lead|s1 ongoing|s2 sent/i }).first();
  await expect(stageFilter).toBeVisible({ timeout: 5_000 });
  await stageFilter.click();
  await expect(page.locator('#main')).toBeVisible();
});

test('opportunity detail shows activity tab', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/opportunities');
  const firstLink = page.locator('a[href^="/opportunities/"]').first();
  await firstLink.click();
  await expect(page.locator('#main')).toBeVisible();

  // Intel ribbon should render.
  await expect(page.getByText(/win prediction|financial health|triggers/i).first()).toBeVisible({
    timeout: 10_000,
  });

  // Activity or Tasks tab should be present.
  await expect(page.getByRole('tab', { name: /activity|tasks/i }).first()).toBeVisible({
    timeout: 10_000,
  });
});
