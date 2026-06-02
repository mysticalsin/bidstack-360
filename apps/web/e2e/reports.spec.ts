import { test, expect } from './fixtures.js';

test.describe('Reports page', () => {
  test('page heading is visible', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/reports');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  });

  test('all report tab buttons are rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/reports');
    // Tabs are plain <button> elements, NOT role="tab"
    await expect(page.getByRole('button', { name: 'Pipeline report tab' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Leads report tab' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Service Desk report tab' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tasks report tab' })).toBeVisible();
  });

  test('Pipeline tab shows KPI cards', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/reports');
    // Default tab is "pipeline"
    await expect(page.getByText('Weighted pipeline')).toBeVisible();
    await expect(page.getByText('Total open')).toBeVisible();
    await expect(page.getByText('Closed this quarter')).toBeVisible();
  });

  test('Pipeline tab shows "Pipeline by stage" section', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/reports');
    await expect(page.getByText('Pipeline by stage')).toBeVisible();
  });

  test('Leads tab renders KPI cards', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/reports');
    await page.getByRole('button', { name: 'Leads report tab' }).click();
    await expect(page.getByText('Total leads')).toBeVisible();
    await expect(page.getByText('Conversion rate')).toBeVisible();
  });

  test('Service Desk tab renders KPI cards', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/reports');
    await page.getByRole('button', { name: 'Service Desk report tab' }).click();
    await expect(page.getByText('Total cases')).toBeVisible();
    await expect(page.getByText('Resolved this month')).toBeVisible();
  });

  test('Tasks tab renders KPI cards', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/reports');
    await page.getByRole('button', { name: 'Tasks report tab' }).click();
    await expect(page.getByText('Total tasks')).toBeVisible();
    await expect(page.getByText('Completion rate')).toBeVisible();
  });
});
