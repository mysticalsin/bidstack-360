import { test, expect } from './fixtures.js';

// The tabbed /reports page was folded into Analytics: /reports now redirects
// to /analytics, and saved reports live at /reports/list. These checks follow
// the current surfaces instead of the retired tab buttons and KPI cards.
test.describe('Reports', () => {
  test('/reports redirects to Analytics', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/reports');
    await expect(page).toHaveURL(/\/analytics$/);
    await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();
  });

  test('Analytics links to the report list and the report builder', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/analytics');
    await expect(page.getByRole('link', { name: 'Reports', exact: true })).toHaveAttribute('href', '/reports/list');
    await expect(page.getByRole('link', { name: 'New report', exact: true })).toHaveAttribute('href', '/reports/new');
  });

  test('report list renders its heading, search and a table or empty state', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/reports/list');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search reports' }).or(page.getByLabel('Search reports'))).toBeVisible();
    await expect(page.getByRole('grid', { name: 'Reports' }).or(page.getByText('No reports found'))).toBeVisible();
  });

  test('report list search narrows to an empty state for nonsense', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/reports/list');
    await page.getByLabel('Search reports').fill('zzzz-no-such-report-zzzz');
    await expect(page.getByText('No reports found')).toBeVisible();
  });
});
