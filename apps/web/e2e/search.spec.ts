import { test, expect } from './fixtures.js';

test('global search page loads and accepts input', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/search');
  const main = page.locator('main');
  const searchInput = main.getByRole('searchbox', { name: 'Search workspace' });
  await searchInput.waitFor({ state: 'visible', timeout: 15_000 });

  await searchInput.fill('MAHLE');
  await page.keyboard.press('Enter');
  await expect(main.getByRole('region', { name: 'Search results' })).toBeVisible({
    timeout: 15_000,
  });
});

test('command palette navigates to contacts', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/dashboard');
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.type('contacts');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/contacts/);
});
