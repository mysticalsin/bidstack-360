import { test, expect } from './fixtures.js';
import { cleanupMeetingImportContacts } from './fixtures/test-data-cleanup.js';

test.beforeEach(async ({ request }) => {
  await cleanupMeetingImportContacts(request);
});

test('contacts list renders with seeded data', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/contacts');
  await page.locator('h1').waitFor({ timeout: 15_000 });
  await expect(page.locator('h1')).toContainText('Contacts', { timeout: 5_000 });
  // Ensure data actually loads (we assume the DB is seeded in E2E environments).
  const tableRows = page.locator('table tbody tr');
  await expect(tableRows.first()).toBeVisible({ timeout: 15_000 });
});

test('contact detail page loads from list click', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/contacts');
  await page.locator('h1').waitFor({ timeout: 15_000 });
  // Ensure data actually loads.
  const tableRows = page.locator('table tbody tr');
  await expect(tableRows.first()).toBeVisible({ timeout: 15_000 });

  const firstLink = page.locator('a[href^="/contacts/"]').first();
  // Fail loud if no links are visible.
  await expect(firstLink).toBeVisible({ timeout: 5_000 });
  const contactName = (await firstLink.innerText()).trim();

  await firstLink.click();
  await expect(page).toHaveURL(/\/contacts\/[^/]+$/);

  const main = page.getByRole('main');
  await expect(main).toBeVisible();
  await expect(main.getByRole('heading', { level: 1, name: contactName })).toBeVisible({
    timeout: 15_000,
  });
  await expect(main.getByRole('heading', { name: 'Opportunities' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Tasks' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Notes' })).toBeVisible();
});
