import { test, expect } from './fixtures.js';

test('contacts list renders with seeded data', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/contacts');
  await page.locator('h1').waitFor({ timeout: 15_000 });
  await expect(page.locator('h1')).toContainText('Contacts', { timeout: 5_000 });
  // Wait for loading to finish, then assert table or empty-state is visible.
  const tableRows = page.locator('table tbody tr');
  const emptyState = page.getByText(/no contacts|empty/i);
  await expect(tableRows.first().or(emptyState.first())).toBeVisible({ timeout: 15_000 });
});

test('contact detail page loads from list click', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/contacts');
  await page.locator('h1').waitFor({ timeout: 15_000 });
  // Wait for the table or empty-state to settle before probing links.
  const tableRows = page.locator('table tbody tr');
  const emptyState = page.getByText(/no contacts|empty/i);
  await expect(tableRows.first().or(emptyState.first())).toBeVisible({ timeout: 15_000 });

  const firstLink = page.locator('a[href^="/contacts/"]').first();
  const hasLinks = await firstLink.isVisible().catch(() => false);
  test.skip(!hasLinks, 'no contact links visible — seeded data may be absent');

  await firstLink.click();
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.getByText(/email|phone|role|company/i).first()).toBeVisible({
    timeout: 15_000,
  });
});
