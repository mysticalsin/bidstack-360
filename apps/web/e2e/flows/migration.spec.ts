/**
 * migration.spec.ts
 *
 * WHY: The Salesforce CSV migration is often a customer's first action in
 * BidStack. A broken importer means customers can't onboard, so this spec
 * targets the live Settings data-import tab instead of stale legacy routes.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';

const SAMPLE_CSV = path.resolve(process.cwd(), 'e2e/fixtures/sample-sf-export.csv');
const DATA_IMPORT_ROUTE = '/settings?tab=data-import';

test.describe('Data migration / import wizard', () => {
  test('data import settings section is accessible', async ({ page }) => {
    await page.goto(DATA_IMPORT_ROUTE, { waitUntil: 'load' });

    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Data import' }).first()).toBeVisible();
    await expect(
      page.getByText('Bring companies, contacts, leads, and opportunities'),
    ).toBeVisible();
  });

  test('CSV file upload input is present', async ({ page }) => {
    await page.goto(DATA_IMPORT_ROUTE, { waitUntil: 'load' });

    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveAttribute('accept', /csv/);
    await expect(page.getByRole('button', { name: /choose a csv file/i })).toBeVisible();
  });

  test('uploading sample CSV advances to mapping step', async ({ page }) => {
    await page.goto(DATA_IMPORT_ROUTE, { waitUntil: 'load' });

    await page.locator('input[type="file"]').setInputFiles(SAMPLE_CSV);
    await expect(page.getByText('Map columns')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('columnheader', { name: 'CSV column' })).toBeVisible();
    await expect(page.getByRole('button', { name: /import \d+ rows/i })).toBeVisible();
  });
});
