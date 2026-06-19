import { test, expect } from './fixtures.js';

test.describe('Audit log page', () => {
  // /audit-log is behind RequireAdmin. Non-admin sessions are redirected to
  // /dashboard. These tests skip gracefully in non-admin sessions.

  test('admin can see the audit log heading', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/audit-log');

    const onDashboard = page.url().includes('/dashboard');
    test.skip(onDashboard, 'Current session is non-admin; redirected to /dashboard');

    await expect(page.getByRole('heading', { name: 'Audit Log', level: 1 })).toBeVisible({
      timeout: 30_000,
    });
  });

  test('filter bar is rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/audit-log');

    const onDashboard = page.url().includes('/dashboard');
    test.skip(onDashboard, 'Current session is non-admin; redirected to /dashboard');

    await expect(page.getByRole('search', { name: 'Audit log filters' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByPlaceholder('Search current page by action, actor, target or diff...')).toBeVisible();
    await expect(page.getByRole('button', { name: /Export visible|Visible CSV|Export CSV/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy view link' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Refresh|Refreshing/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Evidence quality' })).toBeVisible();
  });

  test('table column headers are present', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/audit-log');

    const onDashboard = page.url().includes('/dashboard');
    test.skip(onDashboard, 'Current session is non-admin; redirected to /dashboard');

    const table = page.getByRole('table', { name: 'Audit log entries, newest first' });
    await expect(table).toBeVisible({ timeout: 30_000 });

    await expect(table.getByRole('columnheader', { name: 'Event' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Actor' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Target' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Time' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Details' })).toBeVisible();
  });

  test('audit entries or empty state is shown', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/audit-log');

    const onDashboard = page.url().includes('/dashboard');
    test.skip(onDashboard, 'Current session is non-admin; redirected to /dashboard');

    const rows = page.locator('tbody tr');
    const emptyState = page.getByText(/no audit entries|no entries|no matching evidence/i);
    await expect(rows.or(emptyState).first()).toBeVisible({ timeout: 30_000 });
  });

  test('audit rows expose accessible details when entries exist', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/audit-log');

    const onDashboard = page.url().includes('/dashboard');
    test.skip(onDashboard, 'Current session is non-admin; redirected to /dashboard');

    const inspectButtons = page.locator('button[aria-controls^="audit-log-details-"]');
    const count = await inspectButtons.count();
    test.skip(count === 0, 'No audit entries seeded for this environment');

    await inspectButtons.first().click();
    await expect(page.locator('[id^="audit-log-details-"][role="region"]').first()).toBeVisible();
    await expect(inspectButtons.first()).toHaveAttribute('aria-expanded', 'true');
  });

  test('filters are reflected in the URL for shareable forensic views', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/audit-log');

    const onDashboard = page.url().includes('/dashboard');
    test.skip(onDashboard, 'Current session is non-admin; redirected to /dashboard');

    await page.getByPlaceholder('Search current page by action, actor, target or diff...').fill('product');
    await expect(page).toHaveURL(/q=product/);

    await page.getByRole('button', { name: /Destructive/ }).click();
    await expect(page).toHaveURL(/category=destructive/);
  });
});
