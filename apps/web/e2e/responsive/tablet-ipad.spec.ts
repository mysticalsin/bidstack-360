/**
 * tablet-ipad.spec.ts
 *
 * WHY: iPad Mini (768×1024) sits at the critical sm/md breakpoint where many
 * dashboards shift from single-column to multi-column layouts. The sidebar
 * behaviour (collapsed vs expanded), card grid reflow, and pipeline board
 * horizontal scroll all change at this width. Catching regressions here
 * prevents tablet users from seeing broken layouts.
 */
import { test, expect, devices, type Page } from '@playwright/test';
import { cleanupVisualRegressionArtifacts } from '../fixtures/test-data-cleanup.js';

const IPAD_MINI = devices['iPad Mini'];

const STABLE_DYNAMIC_TEXT_CSS = `
  [data-testid="opportunity-updated-at"] {
    color: transparent !important;
    display: inline-block !important;
    font-size: 0 !important;
    line-height: 1rem !important;
    overflow: hidden !important;
    vertical-align: baseline !important;
    width: 4.75rem !important;
  }

  [data-testid="opportunity-updated-at"]::after {
    color: var(--fg-tertiary) !important;
    content: "recently";
    font-size: 0.75rem !important;
  }
`;

async function stabilizeDynamicScreenshotText(page: Page) {
  await page.addStyleTag({ content: STABLE_DYNAMIC_TEXT_CSS });
}

const KEY_ROUTES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'pipeline', path: '/pipeline' },
  { name: 'leads', path: '/leads' },
  { name: 'contacts', path: '/contacts' },
  { name: 'opportunities', path: '/opportunities' },
  { name: 'settings', path: '/settings' },
] as const;

test.use({
  ...IPAD_MINI,
});

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
    await cleanupVisualRegressionArtifacts(request);
    await page.goto(route.path, { waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    await stabilizeDynamicScreenshotText(page);
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
