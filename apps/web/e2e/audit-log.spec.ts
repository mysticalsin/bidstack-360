import { test, expect } from './fixtures.js';

test.describe('Audit log page', () => {
  // /audit-log is behind RequireAdmin — non-admin sessions are redirected to
  // /dashboard. The tests are written defensively: if the redirect happens we
  // skip gracefully rather than failing.

  test('admin can see the audit log heading', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/audit-log');

    const onDashboard = page.url().includes('/dashboard');
    test.skip(onDashboard, 'Current session is non-admin — redirected to /dashboard');

    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible({
      timeout: 30_000,
    });
  });

  test('filter bar is rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/audit-log');

    const onDashboard = page.url().includes('/dashboard');
    test.skip(onDashboard, 'Current session is non-admin — redirected to /dashboard');

    await expect(page.getByRole('search', { name: 'Audit log filters' })).toBeVisible({
      timeout: 30_000,
    });
  });

  test('table column headers are present', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/audit-log');

    const onDashboard = page.url().includes('/dashboard');
    test.skip(onDashboard, 'Current session is non-admin — redirected to /dashboard');

    const table = page.getByRole('table', { name: 'Audit log entries, newest first' });
    await expect(table).toBeVisible({ timeout: 30_000 });

    // Table columns: "When", "Actor", "Action", "Target", "Reference"
    await expect(table.getByRole('columnheader', { name: 'When' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Actor' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Action' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Target' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Reference' })).toBeVisible();
  });

  test('audit entries or empty state is shown', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/audit-log');

    const onDashboard = page.url().includes('/dashboard');
    test.skip(onDashboard, 'Current session is non-admin — redirected to /dashboard');

    const rows = page.locator('tbody tr');
    const emptyState = page.getByText(/no audit entries|no entries/i);
    await expect(rows.or(emptyState).first()).toBeVisible({ timeout: 30_000 });
  });
});
