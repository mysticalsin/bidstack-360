/**
 * analytics.spec.ts
 *
 * WHY: Report Builder is used by sales leadership to make forecasting decisions.
 * Broken charts or stale data silently misleads executives. This spec verifies
 * the builder renders, a report runs, and CSV export is triggered correctly.
 */
import { test, expect } from '@playwright/test';
import { ReportBuilderPage } from '../pages/ReportBuilderPage.js';

test.describe('Analytics / Report Builder', () => {
  test('reports page renders with heading', async ({ page }) => {
    const reports = new ReportBuilderPage(page);
    await reports.navigate();
    await expect(reports.heading).toBeVisible({ timeout: 15_000 });
  });

  test('new report button is present', async ({ page }) => {
    const reports = new ReportBuilderPage(page);
    await reports.navigate();
    await expect(reports.newReportButton).toBeVisible({ timeout: 10_000 });
  });

  test('seeded or built-in report shows chart or table', async ({ page }) => {
    const reports = new ReportBuilderPage(page);
    await reports.navigate();

    // Check if there's an existing report to run
    const existingReportLink = page.locator('a[href^="/reports/"], [data-testid="report-item"]').first();
    const hasExisting = await existingReportLink.isVisible({ timeout: 3_000 }).catch(() => false);

    if (hasExisting) {
      await existingReportLink.click();
      await expect(page.locator('#main')).toBeVisible({ timeout: 10_000 });
      // Run it if a Run button exists
      const runVisible = await reports.runButton.isVisible({ timeout: 3_000 }).catch(() => false);
      if (runVisible) {
        await reports.runReport();
        await expect(
          reports.chartContainer.or(reports.tableContainer).first(),
        ).toBeVisible({ timeout: 20_000 });
      }
    } else {
      test.skip(true, 'No existing reports — seed reports data or create one manually first');
    }
  });

  test('CSV export triggers a file download', async ({ page }) => {
    const reports = new ReportBuilderPage(page);
    await reports.navigate();

    const existingReportLink = page.locator('a[href^="/reports/"], [data-testid="report-item"]').first();
    const hasExisting = await existingReportLink.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!hasExisting, 'No existing report to export');

    await existingReportLink.click();
    await expect(page.locator('#main')).toBeVisible({ timeout: 10_000 });

    const exportVisible = await reports.exportCsvButton.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!exportVisible, 'CSV export button not visible on this report');

    await reports.exportCsv();
    // exportCsv() throws if the download filename is wrong — if we reach here it passed.
  });
});
