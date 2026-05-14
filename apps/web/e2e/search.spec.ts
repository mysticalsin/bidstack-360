import { test, expect } from './fixtures.js';

test('global search page loads and accepts input', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/search');
  // Search page has no h1; wait for the search input instead.
  const searchInput = page.getByRole('searchbox').or(page.locator('input[type="search"]')).first();
  await searchInput.waitFor({ state: 'visible', timeout: 15_000 });

  await searchInput.fill('MAHLE');
  await page.keyboard.press('Enter');
  // Results region or "no results" message should appear.
  await expect(
    page
      .getByRole('region', { name: /results/i })
      .or(page.getByText(/result|no results|found/i).first()),
  ).toBeVisible({ timeout: 15_000 });
});

test('command palette navigates to contacts', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/dashboard');
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.type('contacts');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/contacts/);
});
