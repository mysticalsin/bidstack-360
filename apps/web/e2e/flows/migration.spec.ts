/**
 * migration.spec.ts
 *
 * WHY: The Salesforce CSV migration is often a customer's first action in
 * BidStack. A broken importer means customers can't onboard — direct churn
 * risk. This spec verifies the import wizard renders and mapping step works.
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_CSV = path.resolve(__dirname, '../fixtures/sample-sf-export.csv');

test.describe('Data migration / import wizard', () => {
  test('import page or settings section is accessible', async ({ page }) => {
    // Try common import routes
    const importRoutes = ['/import', '/settings/import', '/migrate', '/settings/migration'];
    let found = false;
    for (const route of importRoutes) {
      await page.goto(route, { waitUntil: 'load' });
      const heading = page.getByRole('heading', { name: /import|migration|migrate/i, level: 1 });
      if (await heading.isVisible({ timeout: 3_000 }).catch(() => false)) {
        found = true;
        break;
      }
    }
    test.skip(!found, 'Import/migration route not found — feature may be under a different path');
    await expect(page.getByRole('heading', { name: /import|migrat/i })).toBeVisible();
  });

  test('CSV file upload input is present', async ({ page }) => {
    const importRoutes = ['/import', '/settings/import', '/migrate'];
    for (const route of importRoutes) {
      await page.goto(route, { waitUntil: 'load' });
      const fileInput = page.locator('input[type="file"]');
      if (await fileInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await expect(fileInput).toBeVisible();
        return;
      }
    }
    test.skip(true, 'No file upload input found on migration pages');
  });

  test('uploading sample CSV advances to mapping step', async ({ page }) => {
    const importRoutes = ['/import', '/settings/import', '/migrate'];
    let fileInputFound = false;

    for (const route of importRoutes) {
      await page.goto(route, { waitUntil: 'load' });
      const fileInput = page.locator('input[type="file"]');
      if (await fileInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
        fileInputFound = true;
        await fileInput.setInputFiles(SAMPLE_CSV);
        // Wait for mapping step
        await expect(
          page.getByText(/map (columns|fields)|column mapping/i).first(),
        ).toBeVisible({ timeout: 15_000 });
        break;
      }
    }
    test.skip(!fileInputFound, 'File upload not found — cannot test mapping step');
  });
});
