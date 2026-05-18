import { test, expect } from './fixtures.js';

// NOTE: Dark-mode toggle test lives in smoke.spec.ts — do NOT duplicate it here.

test.describe('Settings page', () => {
  test('page heading is visible', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  });

  test('Appearance section is rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/settings');
    await expect(page.getByText('Appearance')).toBeVisible();
    // Theme radio options
    await expect(page.getByRole('radio', { name: 'Light' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeVisible();
  });

  test('Density section is rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/settings');
    await expect(page.getByText('Density')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Compact' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Comfortable' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Spacious' })).toBeVisible();
  });

  test('Motion section is rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/settings');
    await expect(page.getByText('Motion')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'System' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Full motion' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Reduced' })).toBeVisible();
  });

  test('density selection is persisted via radio state', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/settings');
    const spacious = page.getByRole('radio', { name: 'Spacious' });
    await spacious.click();
    await expect(spacious).toBeChecked();
    // Restore to comfortable so we don't affect other tests
    await page.getByRole('radio', { name: 'Comfortable' }).click();
  });
});
