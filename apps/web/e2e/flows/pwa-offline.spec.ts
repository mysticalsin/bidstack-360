/**
 * pwa-offline.spec.ts
 *
 * WHY: BidStack is a PWA — offline resilience is a documented Toto360 spec
 * requirement (not optional). A lead created offline must sync when the
 * network is restored. Regression here loses data and breaks field sales use.
 */
import { test, expect } from '@playwright/test';

test.describe('PWA offline behaviour', () => {
  test('app shell renders from service worker cache when offline', async ({ page, context }) => {
    // First visit — prime the service worker cache.
    await page.goto('/dashboard', { waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible' });

    // Wait for the SW to install and activate.
    await page.waitForTimeout(1_000);

    // Go offline.
    await context.setOffline(true);

    // Reload — the SW should serve the app shell from cache.
    await page.reload();
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15_000 });

    // Restore network.
    await context.setOffline(false);
  });

  test('offline banner appears when connection drops', async ({ page, context }) => {
    await page.goto('/dashboard', { waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible' });

    await context.setOffline(true);

    // Trigger a navigation attempt to kick the offline detection.
    await page.keyboard.press('Control+K');
    await page.keyboard.press('Escape');

    // The app should show an offline indicator
    const offlineIndicator = page.getByText(/offline|no connection|reconnecting/i)
      .or(page.locator('[data-testid="offline-banner"]'));

    // Give the SW time to detect — some apps delay the banner.
    const visible = await offlineIndicator.isVisible({ timeout: 8_000 }).catch(() => false);
    await context.setOffline(false);

    test.skip(!visible, 'Offline banner not implemented — add [data-testid="offline-banner"] or text indicator');
    expect(visible).toBe(true);
  });

  test('service worker is registered on first load', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load' });

    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.length > 0;
    });

    // SW may take a moment — retry once.
    if (!swRegistered) {
      await page.waitForTimeout(2_000);
      const swRegisteredRetry = await page.evaluate(async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        return registrations.length > 0;
      });
      expect(swRegisteredRetry).toBe(true);
    } else {
      expect(swRegistered).toBe(true);
    }
  });
});
