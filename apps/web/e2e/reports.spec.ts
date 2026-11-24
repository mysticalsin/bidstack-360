import { test, expect } from './fixtures.js';

test.describe('Reports route', () => {
  test('legacy /reports lands on analytics with live pipeline widgets', async ({
    page,
    gotoAndWait,
  }) => {
    // WHY: /reports redirects to /analytics. The seeded command-center widgets
    // have no saved report id, and they used to paint "No data available for
    // this time period" even when GET /api/reports/pipeline had open deals.
    // A seeded org must show the weighted value and open stages instead.
    await gotoAndWait('/reports');
    await expect(page).toHaveURL(/\/analytics/);
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();

    const weighted = page.getByRole('region', { name: 'Weighted Pipeline' });
    await expect(weighted).toBeVisible();
    await expect(weighted.getByText('No data available for this time period.')).toHaveCount(0);
    await expect(weighted.getByLabel(/Weighted Pipeline:.*[1-9]/)).toBeVisible();

    const byStage = page.getByRole('region', { name: 'Pipeline by Stage' });
    await expect(byStage.getByText('No data available for this time period.')).toHaveCount(0);
    await expect(byStage.getByRole('img', { name: 'Pipeline by Stage' })).toBeVisible();
    await expect(byStage.locator('table').getByText('s1 ongoing')).toBeAttached();
  });
});
