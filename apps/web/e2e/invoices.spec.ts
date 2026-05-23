import { test, expect } from './fixtures.js';
import type { Locator, Page } from '@playwright/test';

async function expectInvoicesMain(page: Page): Promise<Locator> {
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  return main;
}

test.describe('Invoices page', () => {
  // Route is /sales/invoices, not /invoices
  test('page heading is visible', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/sales/invoices');
    await expectInvoicesMain(page);
  });

  test('"+ New invoice" link is present', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/sales/invoices');
    // Rendered as a <Link> with text "+ New invoice"
    const main = await expectInvoicesMain(page);
    await expect(main.getByRole('link', { name: '+ New invoice' })).toBeVisible();
  });

  test('"+ New invoice" link targets the create route', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/sales/invoices');
    const main = await expectInvoicesMain(page);
    const link = main.getByRole('link', { name: '+ New invoice' });
    await expect(link).toHaveAttribute('href', '/sales/invoices/new');
  });

  test('filter chips are rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/sales/invoices');
    const main = await expectInvoicesMain(page);
    await expect(main.getByRole('button', { name: 'All' })).toBeVisible({ timeout: 15_000 });
    await expect(main.getByRole('button', { name: 'Draft' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Sent' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Paid' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Overdue' })).toBeVisible();
  });

  test('invoice list or empty state is shown', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/sales/invoices');
    const main = await expectInvoicesMain(page);
    const table = main.getByRole('table');
    const emptyState = main.getByRole('heading', { name: /no invoices match/i });
    await expect(table.or(emptyState).first()).toBeVisible({ timeout: 15_000 });
  });
});
