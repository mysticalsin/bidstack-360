/**
 * mobile-iphone-se.spec.ts
 *
 * WHY: iPhone SE (375×667) is the smallest common viewport BidStack must
 * support per Toto360 spec. Text overflow, off-screen nav, and broken touch
 * targets on this device affect a significant portion of mobile users.
 * Screenshots captured here form the visual-regression baseline.
 */
import { test, expect, devices } from '@playwright/test';
import { cleanupMeetingImportContacts } from '../fixtures/test-data-cleanup.js';

const IPHONE_SE = devices['iPhone SE'];

const KEY_ROUTES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'pipeline', path: '/pipeline' },
  { name: 'leads', path: '/leads' },
  { name: 'contacts', path: '/contacts' },
  { name: 'opportunities', path: '/opportunities' },
  { name: 'settings', path: '/settings' },
] as const;

test.use({
  ...IPHONE_SE,
  // Touch events enabled by default for iPhone SE emulation
});

for (const route of KEY_ROUTES) {
  test(`${route.name}: renders without horizontal overflow on iPhone SE`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});

    // Check for horizontal scrollbar (indicates content overflow)
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    if (hasHorizontalScroll) {
      await page.screenshot({ path: `playwright-report/mobile-overflow-${route.name}-iphonese.png`, fullPage: false });
      throw new Error(`Horizontal overflow on iPhone SE at ${route.path}`);
    }
    expect(hasHorizontalScroll).toBe(false);
  });

  test(`${route.name}: main landmark is visible on iPhone SE`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'load' });
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15_000 });
  });

  test(`${route.name}: screenshot baseline (iPhone SE)`, async ({ page, request }) => {
    if (route.name === 'contacts') {
      await cleanupMeetingImportContacts(request);
    }
    await page.goto(route.path, { waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(500); // Let animations settle

    // Capture baseline; compare on subsequent runs with --update-snapshots to refresh.
    await expect(page).toHaveScreenshot(`${route.name}-iphonese.png`, {
      maxDiffPixelRatio: 0.02, // 2% pixel diff tolerance
    });
  });
}
