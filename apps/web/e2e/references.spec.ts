// Reference Library — the density-retarget acceptance line for surface 4
// (ROUND2-ULTRAPLAN): "URL round-trips the exact view" and "zero blank-table
// frames after first paint".
//
// Before this change search/industry/tag lived in `useState`, so none of the
// assertions below were even expressible: every filtered view had the same URL.
// These tests exist to stop that regressing — if a filter ever stops writing to
// the query string, or a default starts littering it, this file goes red.

import type { Page } from '@playwright/test';

import { test, expect } from './fixtures.js';

// Seeded by packages/db/src/seed.ts ("References Library (F9)"): three case
// studies, two `financial_services` and one `healthcare`.
//
// Exact titles, not substrings: at table density the company name, the title
// and the delete button's aria-label all contain "CI Financial", so a loose
// matcher is a strict-mode violation rather than a test.
const HEALTHCARE_TITLE = 'Rush University — EHR cloud migration';
const FINANCE_TITLE = 'CI Financial — Core banking platform modernization';
const DNB_TITLE = 'DNB Bank — Multi-region cloud landing zone';

const titleCell = (page: Page, title: string) =>
  page.getByRole('cell', { name: title, exact: true });

test.describe('Reference Library — the URL is the view', () => {
  test('opens as a dense table with a clean querystring', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/references');

    await expect(page.getByRole('heading', { name: 'Reference Library', level: 1 })).toBeVisible();
    // The table frame — header row included — is on screen before any row data
    // resolves, so there is no blank-then-populate flash.
    await expect(page.getByRole('columnheader', { name: 'Reference' })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();

    // Defaults (sort=usageCount, dir=desc, page=1, pageSize=25, facets=all) are
    // NOT written to the URL — a freshly opened library is a bare /references.
    expect(new URL(page.url()).search).toBe('');

    await expect(titleCell(page, FINANCE_TITLE)).toBeVisible({ timeout: 15_000 });
  });

  test('a facet writes the URL, survives a reload, and clears back to nothing', async ({
    page,
    gotoAndWait,
  }) => {
    await gotoAndWait('/references');
    await expect(titleCell(page, FINANCE_TITLE)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'All industries' }).click();
    await page.getByRole('menuitemradio', { name: 'healthcare' }).click();

    await expect(page).toHaveURL(/[?&]industry=healthcare/);
    // The frame never unmounts while the filtered query is in flight.
    await expect(page.getByRole('table')).toBeVisible();
    await expect(titleCell(page, HEALTHCARE_TITLE)).toBeVisible();
    await expect(titleCell(page, FINANCE_TITLE)).toHaveCount(0);

    // The whole point: the link reproduces the exact view for somebody else.
    const shared = page.url();
    await page.goto('/references', { waitUntil: 'load' });
    await page.goto(shared, { waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible' });
    await expect(page.getByRole('button', { name: 'healthcare' })).toBeVisible();
    await expect(titleCell(page, HEALTHCARE_TITLE)).toBeVisible({
      timeout: 15_000,
    });

    // Clearing writes nothing back — `all` is a default, and defaults are litter.
    await page.getByRole('button', { name: 'healthcare' }).click();
    await page.getByRole('menuitemradio', { name: 'All industries' }).click();
    await expect(page).toHaveURL(/\/references$/);
    await expect(titleCell(page, FINANCE_TITLE)).toBeVisible();
  });

  test('the search box round-trips through ?q=', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/references');
    await expect(titleCell(page, FINANCE_TITLE)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('searchbox', { name: 'Search references' }).fill('DNB');

    await expect(page).toHaveURL(/[?&]q=DNB/);
    await expect(page.getByRole('table')).toBeVisible();
    await expect(titleCell(page, DNB_TITLE)).toBeVisible({ timeout: 15_000 });
    await expect(titleCell(page, FINANCE_TITLE)).toHaveCount(0);

    // A reload rehydrates the box from the URL — not from component state.
    await page.reload({ waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible' });
    await expect(page.getByRole('searchbox', { name: 'Search references' })).toHaveValue('DNB');
    await expect(titleCell(page, DNB_TITLE)).toBeVisible({ timeout: 15_000 });
  });

  test('an expanded row is part of the shareable URL', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/references');

    const row = titleCell(page, FINANCE_TITLE);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    // The long-form case-study text the card grid used to print inline now lives
    // one click down, and that click is in the link.
    await expect(page).toHaveURL(/[?&]expand=4ef00000/);
    await expect(page.getByText(/Migrated a legacy core-banking monolith/)).toBeVisible();

    await page.reload({ waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible' });
    await expect(page.getByText(/Migrated a legacy core-banking monolith/)).toBeVisible({
      timeout: 15_000,
    });
  });
});
