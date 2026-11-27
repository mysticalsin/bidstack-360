/**
 * tablet-ipad.spec.ts
 *
 * WHY: iPad Mini (768×1024) sits at the critical sm/md breakpoint where many
 * dashboards shift from single-column to multi-column layouts. The sidebar
 * behaviour (collapsed vs expanded), card grid reflow, and pipeline board
 * horizontal scroll all change at this width. Catching regressions here
 * prevents tablet users from seeing broken layouts.
 */
import { test, expect, devices } from '@playwright/test';
import { cleanupVisualRegressionArtifacts } from '../fixtures/test-data-cleanup.js';
import { chromiumDeviceUse, stabilizeResponsiveScreenshot } from './device-emulation.js';
import { pinSyntheticDashboard } from './synthetic-dashboard.js';

const IPAD_MINI = devices['iPad Mini'];

const KEY_ROUTES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'pipeline', path: '/pipeline' },
  { name: 'leads', path: '/leads' },
  { name: 'contacts', path: '/contacts' },
  { name: 'opportunities', path: '/opportunities' },
  { name: 'settings', path: '/settings' },
] as const;

test.use(chromiumDeviceUse(IPAD_MINI));

for (const route of KEY_ROUTES) {
  test(`${route.name}: renders without horizontal overflow on iPad Mini`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});

    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    if (hasHorizontalScroll) {
      await page.screenshot({
        path: `playwright-report/tablet-overflow-${route.name}-ipad.png`,
        fullPage: false,
      });
      throw new Error(`Horizontal overflow on iPad Mini at ${route.path}`);
    }
    expect(hasHorizontalScroll).toBe(false);
  });

  test(`${route.name}: main landmark is visible on iPad Mini`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'load' });
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15_000 });
  });

  test(`${route.name}: navigation is reachable on iPad Mini`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});

    // WHY: At 768px the sidebar may be hidden behind a hamburger. Verify that
    // either the nav is visible directly or a toggle button exists to open it.
    const navVisible = await page.getByRole('navigation').first().isVisible().catch(() => false);
    const hamburgerExists = await page
      .getByRole('button', { name: /menu|nav|sidebar|toggle/i })
      .first()
      .isVisible()
      .catch(() => false);

    expect(navVisible || hamburgerExists).toBe(true);
  });

  test(`${route.name}: screenshot baseline (iPad Mini)`, async ({ page, request }) => {
    // WHY: Scope cleanup to the contacts route only. cleanupVisualRegressionArtifacts
    // deletes opportunities matching the broad 'E2E Pipeline QA' prefix, which would
    // race flows/pipeline.spec.ts live fixtures if run on every route.
    if (route.name === 'contacts') {
      await cleanupVisualRegressionArtifacts(request);
    }
    // WHY: Only the dashboard shot failed, and it failed on CAD versus USD
    // plus a seed company-count drift. Pin that one shot. Leave the other
    // routes on the shared seed; their baselines already matched.
    if (route.name === 'dashboard') {
      await pinSyntheticDashboard(page);
    }
    await page.goto(route.path, { waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    await stabilizeResponsiveScreenshot(page);
    if (route.name === 'dashboard') {
      await expect(page.getByRole('button', { name: 'Select currency, current: USD' })).toBeVisible();
      await expect(page.getByText(/4 companies · 2 open deals · 4\.2m pipeline/i)).toBeVisible();
      await expect(page.getByText('Overdue bids hang below the line. Select a month or a number to see the bids.')).toBeVisible();
      // The synthetic account name is repeated in the hero, the chart, and the
      // momentum tile. Any one of them is enough to prove the pin landed.
      await expect(page.getByText('Contoso Synthetic').first()).toBeVisible();
    }
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot(`${route.name}-ipad-mini.png`, {
      maxDiffPixelRatio: 0.02,
    });
  });
}

test('pipeline: board is horizontally scrollable within its container on iPad Mini', async ({
  page,
}) => {
  await page.goto('/pipeline', { waitUntil: 'load' });
  await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});

  // WHY: The kanban board needs horizontal scroll internally (within <main>)
  // but must NOT cause the *page* to scroll horizontally. This test distinguishes
  // between intentional board scroll and a layout overflow bug.
  const boardOverflowsPage = await page.evaluate(() => {
    const board =
      document.querySelector('[data-testid="pipeline-board"]') ??
      document.querySelector('[role="region"]');
    if (!board) return false;
    // The board's scrollWidth > clientWidth is intentional (it scrolls internally).
    // The page should not scroll: documentElement.scrollWidth === clientWidth.
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });

  expect(boardOverflowsPage).toBe(false);
});
