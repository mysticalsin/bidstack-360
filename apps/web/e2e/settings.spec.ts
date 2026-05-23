import { test, expect } from './fixtures.js';
import type { Page } from '@playwright/test';

// NOTE: Dark-mode toggle test lives in smoke.spec.ts — do NOT duplicate it here.

test.describe('Settings page', () => {
  async function openAppearance(page: Page, gotoAndWait: (path: string) => Promise<void>) {
    await gotoAndWait('/settings');
    await page.getByRole('button', { name: 'Appearance' }).click();
  }

  test('page heading is visible', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  });

  test('Appearance section is rendered', async ({ page, gotoAndWait }) => {
    await openAppearance(page, gotoAndWait);
    await expect(page.getByRole('heading', { name: 'Appearance', level: 2 })).toBeVisible();
    // Theme radio options
    await expect(page.getByRole('radio', { name: 'Light' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeVisible();
  });

  test('Density section is rendered', async ({ page, gotoAndWait }) => {
    await openAppearance(page, gotoAndWait);
    await expect(page.getByRole('heading', { name: 'Density' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Compact' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Comfortable' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Spacious' })).toBeVisible();
  });

  test('Motion section is rendered', async ({ page, gotoAndWait }) => {
    await openAppearance(page, gotoAndWait);
    await expect(page.getByRole('heading', { name: 'Motion' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'System' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Full motion' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Reduced' })).toBeVisible();
  });

  test('visual effects preference persists after navigation', async ({ page, gotoAndWait }) => {
    await openAppearance(page, gotoAndWait);
    const visualEffects = page.getByRole('checkbox', { name: 'BidStack neural background' });

    await visualEffects.check();
    await visualEffects.uncheck();
    await expect(visualEffects).not.toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-visual-effects', 'off');

    await page.reload();
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-visual-effects', 'off');

    await openAppearance(page, gotoAndWait);
    const persistedVisualEffects = page.getByRole('checkbox', {
      name: 'BidStack neural background',
    });
    await expect(persistedVisualEffects).not.toBeChecked();

    await persistedVisualEffects.check();
  });

  test('density selection is persisted via radio state', async ({ page, gotoAndWait }) => {
    await openAppearance(page, gotoAndWait);
    const spacious = page.getByRole('radio', { name: 'Spacious' });
    await spacious.click();
    await expect(spacious).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'spacious');
    // Restore to comfortable so we don't affect other tests
    await page.getByRole('radio', { name: 'Comfortable' }).click();
  });
});
