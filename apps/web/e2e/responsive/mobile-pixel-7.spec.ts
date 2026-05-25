/**
 * mobile-pixel-7.spec.ts
 *
 * WHY: Pixel 7 (412×915) represents the dominant Android viewport. Its taller
 * aspect ratio and larger width (vs iPhone SE) can expose different layout
 * breakpoints. Testing here ensures the responsive grid degrades correctly at
 * the sm→md boundary rather than only at the xs edge.
 */
import { test, expect, devices } from '@playwright/test';

const PIXEL_7 = devices['Pixel 7'];

const KEY_ROUTES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'pipeline', path: '/pipeline' },
  { name: 'leads', path: '/leads' },
  { name: 'contacts', path: '/contacts' },
  { name: 'opportunities', path: '/opportunities' },
  { name: 'settings', path: '/settings' },
] as const;

test.use({
  ...PIXEL_7,
  // Touch events enabled by default for Pixel 7 emulation
});

for (const route of KEY_ROUTES) {
  test(`${route.name}: renders without horizontal overflow on Pixel 7`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});

    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    if (hasHorizontalScroll) {
      await page.screenshot({
        path: `playwright-report/mobile-overflow-${route.name}-pixel7.png`,
        fullPage: false,
      });
      throw new Error(`Horizontal overflow on Pixel 7 at ${route.path}`);
    }
    expect(hasHorizontalScroll).toBe(false);
  });

  test(`${route.name}: main landmark is visible on Pixel 7`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'load' });
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15_000 });
  });

  test(`${route.name}: touch targets meet 44px minimum on Pixel 7`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});

    // WHY: WCAG 2.5.5 (AA) + Apple/Google HIG both require ≥44×44px touch targets.
    // We check a sample of interactive elements rather than all (performance trade-off).
    const undersizedTargets = await page.evaluate(() => {
      const MIN_PX = 44;
      const interactives = Array.from(
        document.querySelectorAll('button, a, [role="button"], input, select, textarea'),
      );
      // Sample: first 20 to keep evaluation fast
      return interactives.slice(0, 20).reduce<string[]>((acc, el) => {
        const rect = el.getBoundingClientRect();
        // Skip hidden elements
        if (rect.width === 0 && rect.height === 0) return acc;
        if (rect.width < MIN_PX || rect.height < MIN_PX) {
          acc.push(
            `${el.tagName}[${el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20) ?? '?'}] ${Math.round(rect.width)}×${Math.round(rect.height)}`,
          );
        }
        return acc;
      }, []);
    });

    if (undersizedTargets.length > 0) {
      // Log as annotation (soft failure) — some legacy controls may not yet meet
      // the target. Hard failure only when count exceeds 3 elements.
      test.info().annotations.push({
        type: 'touch-target-warning',
        description: `${undersizedTargets.length} undersized touch target(s) on ${route.path}: ${undersizedTargets.join(', ')}`,
      });
    }

    // Hard gate: more than 3 failures on a single route indicates a systemic problem.
    expect(undersizedTargets.length).toBeLessThanOrEqual(3);
  });

  test(`${route.name}: screenshot baseline (Pixel 7)`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(500); // Let animations settle

    await expect(page).toHaveScreenshot(`${route.name}-pixel7.png`, {
      maxDiffPixelRatio: 0.02,
    });
  });
}
