import { test, expect } from './fixtures.js';

test.describe('Invoices page', () => {
  // Route is /sales/invoices, not /invoices
  test('page heading is visible', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/sales/invoices');
    await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
  });

  test('"+ New invoice" link is present', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/sales/invoices');
    // Rendered as a <Link> with text "+ New invoice"
    await expect(page.getByRole('link', { name: '+ New invoice' })).toBeVisible();
  });

  test('"+ New invoice" link targets the create route', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/sales/invoices');
    const link = page.getByRole('link', { name: '+ New invoice' });
    await expect(link).toHaveAttribute('href', '/sales/invoices/new');
  });

  test('filter chips are rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/sales/invoices');
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Draft' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sent' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Paid' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Overdue' })).toBeVisible();
  });

  test('invoice list or empty state is shown', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/sales/invoices');
    const table = page.locator('table');
    const emptyState = page.getByText(/no invoices|nothing here/i);
    await expect(table.or(emptyState).first()).toBeVisible();
  });
});
