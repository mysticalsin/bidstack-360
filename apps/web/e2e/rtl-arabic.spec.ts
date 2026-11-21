// Why this test exists: Arabic is a supported locale. If <html> stays ltr,
// the rail, breadcrumbs, and drawers paint on the wrong edge. A page that
// overflows the viewport at phone width is not usable in that direction.

import { test, expect } from './fixtures.js';

const PAGES = [
  '/dashboard',
  '/accounts',
  '/pipeline',
  '/opportunities',
  '/tasks',
  '/settings?tab=data-import',
  '/proposals',
  '/settings',
] as const;

test.describe('Arabic RTL', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('bidstack-locale', 'ar');
      document.cookie = 'bidstack-locale=ar; path=/; SameSite=Lax';
    });
  });

  test('sets dir=rtl and does not overflow the viewport', async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path, { waitUntil: 'load' });
      await expect
        .poll(async () => page.locator('html').getAttribute('dir'), { timeout: 15_000 })
        .toBe('rtl');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1);
    }

    await page.goto('/accounts', { waitUntil: 'load' });
    const account = page.locator('a[href^="/accounts/"]').first();
    await expect(account).toBeVisible({ timeout: 15_000 });
    await account.click();
    await expect
      .poll(async () => page.locator('html').getAttribute('dir'))
      .toBe('rtl');
    const accountOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(accountOverflow, 'account page horizontal overflow').toBeLessThanOrEqual(1);
  });
});

test.describe('Arabic RTL login', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    storageState: { cookies: [], origins: [] },
  });

  test('login sets dir=rtl without horizontal overflow', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('bidstack-locale', 'ar');
      document.cookie = 'bidstack-locale=ar; path=/; SameSite=Lax';
    });
    await page.goto('/login', { waitUntil: 'load' });
    await expect
      .poll(async () => page.locator('html').getAttribute('dir'), { timeout: 15_000 })
      .toBe('rtl');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'login horizontal overflow').toBeLessThanOrEqual(1);
  });
});
