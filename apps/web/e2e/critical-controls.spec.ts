import { test, expect } from './fixtures.js';

test.describe('Critical interactive controls', () => {
  test('opportunity toolbar buttons open workflows, export data, and switch views', async ({
    page,
    gotoAndWait,
  }) => {
    await gotoAndWait('/opportunities');
    await expect(page.getByRole('heading', { name: 'Opportunities', level: 1 })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Switch to kanban view' }).click();
    await expect(page).toHaveURL(/\/pipeline/);
    await expect(page.getByRole('heading', { name: 'Pipeline', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'List' }).click();
    await expect(page).toHaveURL(/\/opportunities/);

    await page.getByRole('button', { name: /^Import$/ }).click();
    const importDialog = page.getByRole('dialog', { name: 'Import Opportunities' });
    await expect(importDialog).toBeVisible();
    const importSubmit = importDialog.getByRole('button', { name: /^Import$/ });
    await expect(importSubmit).toBeDisabled();
    await importDialog.getByRole('textbox').fill('not-json');
    await expect(importSubmit).toBeEnabled();
    await importSubmit.click();
    await expect(page.getByText('Invalid JSON')).toBeVisible();
    await importDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(importDialog).toBeHidden();

    const exportButton = page.getByRole('button', {
      name: 'Export visible opportunities as CSV',
    });
    await expect(exportButton).toBeEnabled();
    const exportResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/opportunities/export') &&
        response.request().method() === 'GET',
    );
    await exportButton.click();
    expect((await exportResponse).ok()).toBe(true);
    await expect(page.getByText('Export complete')).toBeVisible({ timeout: 15_000 });
    await expect(exportButton).toBeEnabled({ timeout: 15_000 });

    await page.getByRole('button', { name: /\+ New opportunity|New opportunity/i }).click();
    const createDialog = page.getByRole('dialog', { name: 'New opportunity' });
    await expect(createDialog).toBeVisible();
    await expect(createDialog.getByLabel('Customer')).toBeVisible();
    await expect(createDialog.getByLabel('Opportunity name')).toBeVisible();
    await createDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(createDialog).toBeHidden();
  });

  test('topbar controls open, toggle, and stay keyboard reachable', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/dashboard');
    await expect(page.getByRole('main')).toBeVisible();

    const themeButton = page.getByRole('button', { name: /Switch to (light|dark) mode/ });
    const initialThemeLabel = await themeButton.getAttribute('aria-label');
    await themeButton.click();
    await expect(themeButton).not.toHaveAttribute('aria-label', initialThemeLabel ?? '');

    await page.getByRole('button', { name: 'Help and keyboard shortcuts' }).click();
    const helpDialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(helpDialog).toBeVisible();
    await expect(helpDialog.getByText('Open command palette')).toBeVisible();
    await helpDialog.getByRole('button', { name: 'Close shortcuts' }).click();
    await expect(helpDialog).toBeHidden();

    await page.getByTestId('notification-bell').click();
    await expect(page.getByTestId('notification-tray')).toBeVisible();
    await page.getByTestId('notification-bell').click();
    await expect(page.getByTestId('notification-tray')).toBeHidden();

    const currencyButton = page.getByRole('button', { name: /Select currency, current:/ });
    await currencyButton.click();
    const currencyList = page.getByRole('listbox', { name: 'Select currency' });
    await expect(currencyList).toBeVisible();
    await currencyList.getByRole('option', { name: /USD/ }).click();
    await expect(currencyButton).toHaveAccessibleName(/current: USD/);

    await page.keyboard.press('n');
    const quickAdd = page.getByRole('dialog', { name: 'Create' });
    await expect(quickAdd).toBeVisible();
    await quickAdd.getByRole('option', { name: /New opportunity/ }).click();
    const createDialog = page.getByRole('dialog', { name: 'New opportunity' });
    await expect(createDialog).toBeVisible();
    await createDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(createDialog).toBeHidden();
  });
});
