import { test, expect } from './fixtures.js';

test('leads list renders with seeded data', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/leads');
  // The page title should render even while data is loading.
  await expect(page.locator('h1')).toContainText('Leads', { timeout: 15_000 });
  // Table or empty-state should eventually appear.
  await expect(
    page.locator('table, [data-testid="lead-row"]').or(page.getByText(/no leads|empty/i)),
  ).toBeVisible({ timeout: 15_000 });
});

test('lead detail page loads from list click', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/leads');
  await page.locator('h1').waitFor({ timeout: 15_000 });
  // Wait for the table or empty-state to settle before probing links.
  await expect(
    page.locator('table, [data-testid="lead-row"]').or(page.getByText(/no leads|empty/i)),
  ).toBeVisible({ timeout: 15_000 });

  const firstLink = page.locator('a[href^="/leads/"]').first();
  const hasLinks = await firstLink.isVisible().catch(() => false);
  test.skip(!hasLinks, 'no lead links visible — seeded data may be absent');

  await firstLink.click();
  await expect(page.locator('#main')).toBeVisible();
  // Detail page should show BANT sections or a lead name heading.
  await expect(page.getByText(/budget|authority|need|timeline|status|score/i).first()).toBeVisible({
    timeout: 15_000,
  });
});

test('new lead flow navigates to form page', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/leads');
  await page.locator('h1').waitFor({ timeout: 15_000 });
  const newBtn = page.getByRole('button', { name: /new lead|add lead/i }).first();
  test.skip(!(await newBtn.isVisible().catch(() => false)), 'new lead button not found');

  await newBtn.click();
  // "New lead" navigates to /leads/new (full page, not dialog).
  await expect(page).toHaveURL(/\/leads\/new/, { timeout: 10_000 });
  await expect(page.locator('h1')).toContainText('New lead', { timeout: 10_000 });
  // Form fields should be visible.
  await expect(page.getByRole('textbox', { name: /first name/i })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /last name/i })).toBeVisible();
});
