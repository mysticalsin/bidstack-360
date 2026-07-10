import { test, expect } from './fixtures.js';

test.describe('Cross-sell actions', () => {
  test('renders explicit workflow commands on seeded org data', async ({
    page,
    gotoAndWait,
  }, testInfo) => {
    await gotoAndWait('/cross-sell');

    await expect(page.getByRole('heading', { name: 'Cross-sell actions', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Cross-sell command queue' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Next move' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Start cross-sell action/i }).first(),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole('button', { name: /Mark done cross-sell action/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Reopen cross-sell action/i }).first(),
    ).toBeVisible();

    const statusFilters = page.getByRole('group', { name: 'Filter by status' });
    await statusFilters.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      page.getByRole('button', { name: /Reopen cross-sell action/i }).first(),
    ).toBeVisible();
    await statusFilters.getByRole('button', { name: 'All', exact: true }).click();

    await page.screenshot({ path: testInfo.outputPath('cross-sell-actions.png'), fullPage: true });
  });
});
