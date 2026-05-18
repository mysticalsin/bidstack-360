import { test, expect } from './fixtures.js';

test.describe('Service Desk page', () => {
  test('page heading is visible', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/service-desk');
    await expect(page.getByRole('heading', { name: 'Service Desk', level: 1 })).toBeVisible();
  });

  test('filter controls are rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/service-desk');
    // Search input
    await expect(page.getByPlaceholder('Search cases…')).toBeVisible();
    // Status select always present (first <select> in the filter bar)
    const selects = page.locator('select');
    await expect(selects.first()).toBeVisible();
  });

  test('case list or empty state is shown', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/service-desk');
    const table = page.locator('table');
    const emptyState = page.getByText(/No cases yet/i);
    await expect(table.or(emptyState).first()).toBeVisible();
  });

  test('table column headers are present when data exists', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/service-desk');

    const tableVisible = await page.locator('table').isVisible();
    test.skip(!tableVisible, 'No cases — table not rendered');

    // Table columns per ServiceDeskPage.tsx: "#", "Subject", "Status", "Priority", "Owner", "Source"
    await expect(page.getByRole('columnheader', { name: 'Subject' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Priority' })).toBeVisible();
  });

  test('case rows link to detail page', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/service-desk');

    const caseLinks = page.locator('a[href^="/service-desk/"]');
    const hasLinks = (await caseLinks.count()) > 0;
    test.skip(!hasLinks, 'No case rows — cannot verify links without seeded data');

    await expect(caseLinks.first()).toBeVisible();
  });
});
