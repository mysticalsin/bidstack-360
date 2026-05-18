import { test, expect } from './fixtures.js';

test.describe('Bulk actions — Companies', () => {
  test('select-all checkbox is present', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/companies');
    await expect(page.getByRole('checkbox', { name: /Select all|Deselect all/i })).toBeVisible();
  });

  test('bulk action bar appears after selecting a company', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/companies');

    // BulkActionBar only renders when count > 0.
    // Find the first per-row "Select <company>" checkbox.
    const rowCheckboxes = page.getByRole('checkbox', {
      name: /^Select (?!all|none)/i,
    });
    const hasRows = (await rowCheckboxes.count()) > 0;
    test.skip(!hasRows, 'No company rows — cannot test bulk selection without seeded data');

    await rowCheckboxes.first().check();

    // BulkActionBar renders role="region" aria-label="Bulk actions"
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toBeVisible();

    // Default labels from BulkActionBar component
    await expect(page.getByRole('button', { name: 'Export selected' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete selected' })).toBeVisible();
  });

  test('bulk action bar disappears after clearing selection', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/companies');

    const rowCheckboxes = page.getByRole('checkbox', {
      name: /^Select (?!all|none)/i,
    });
    const hasRows = (await rowCheckboxes.count()) > 0;
    test.skip(!hasRows, 'No company rows — cannot test bulk selection without seeded data');

    await rowCheckboxes.first().check();
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toBeVisible();

    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByRole('region', { name: 'Bulk actions' })).not.toBeVisible();
  });
});

test.describe('Bulk actions — Leads', () => {
  test('select-all checkbox is present', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/leads');
    await expect(page.getByRole('checkbox', { name: /Select all|Deselect all/i })).toBeVisible();
  });

  test('bulk action bar appears after selecting a lead', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/leads');

    // Per-row checkboxes: aria-label="Select {firstName} {lastName}"
    const rowCheckboxes = page.getByRole('checkbox', {
      name: /^Select (?!all|none)/i,
    });
    const hasRows = (await rowCheckboxes.count()) > 0;
    test.skip(!hasRows, 'No lead rows — cannot test bulk selection without seeded data');

    await rowCheckboxes.first().check();

    await expect(page.getByRole('region', { name: 'Bulk actions' })).toBeVisible();
  });
});
