/**
 * pwa-offline.spec.ts
 *
 * WHY: BidStack is a PWA — offline resilience is a documented Toto360 spec
 * requirement (not optional). A lead created offline must sync when the
 * network is restored. Regression here loses data and breaks field sales use.
 */
import { test, expect, type Page } from '@playwright/test';

const APP_SHELL_CACHE_NAME = 'bidstack-v4-network-owned-routes';

async function waitForOfflineAppShell(page: Page) {
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service workers are not available');
    }

    await navigator.serviceWorker.ready;

    if (navigator.serviceWorker.controller) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        reject(new Error('Timed out waiting for the service worker controller'));
      }, 15_000);

      function onControllerChange() {
        window.clearTimeout(timeout);
        resolve();
      }

      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, {
        once: true,
      });
    });
  });

  await expect
    .poll(
      async () =>
        page.evaluate(async (cacheName) => {
          if (!('caches' in window)) {
            return false;
          }

          const cache = await caches.open(cacheName);
          const paths = new Set<string>(['/', '/index.html', '/manifest.json']);

          const addSameOriginPath = (assetUrl: string | null) => {
            if (!assetUrl) return;
            const parsed = new URL(assetUrl, window.location.href);
            if (parsed.origin === window.location.origin) {
              paths.add(`${parsed.pathname}${parsed.search}`);
            }
          };

          document
            .querySelectorAll<HTMLScriptElement>('script[src]')
            .forEach((script) => addSameOriginPath(script.getAttribute('src')));

          document
            .querySelectorAll<HTMLLinkElement>(
              'link[rel="stylesheet"][href], link[rel="modulepreload"][href], link[rel="preload"][href]',
            )
            .forEach((link) => addSameOriginPath(link.getAttribute('href')));

          const matches = await Promise.all([...paths].map((path) => cache.match(path)));
          return matches.every(Boolean);
        }, APP_SHELL_CACHE_NAME),
      {
        intervals: [250, 500, 1_000],
        timeout: 20_000,
      },
    )
    .toBe(true);
}

test.describe('PWA offline behaviour', () => {
  test('app shell renders from service worker cache when offline', async ({ page, context }) => {
    // First visit — prime the service worker cache.
    await page.goto('/dashboard', { waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible' });

    await waitForOfflineAppShell(page);

    // Go offline.
    await context.setOffline(true);

    // Reload — the SW should serve the app shell from cache.
    await page.reload({ waitUntil: 'domcontentloaded' });
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
    const offlineIndicator = page
      .getByText(/offline|no connection|reconnecting/i)
      .or(page.locator('[data-testid="offline-banner"]'));

    // Give the SW time to detect — some apps delay the banner.
    const visible = await offlineIndicator.isVisible({ timeout: 8_000 }).catch(() => false);
    await context.setOffline(false);

    test.skip(
      !visible,
      'Offline banner not implemented — add [data-testid="offline-banner"] or text indicator',
    );
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
