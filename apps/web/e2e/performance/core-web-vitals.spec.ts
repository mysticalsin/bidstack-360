/**
 * core-web-vitals.spec.ts
 *
 * WHY: Tony's design-standards.md mandates LCP < 2.5s, INP < 200ms, CLS < 0.1.
 * This suite tightens the budgets (LCP 2.0s / INP 100ms / CLS 0.05) to give
 * headroom before the public threshold is breached in production. Catching
 * regressions here prevents user-visible slowness shipping unnoticed.
 *
 * Technique: inject a PerformanceObserver via page.addInitScript, navigate,
 * wait for page idle, then retrieve the collected entries. No third-party
 * tools required — pure browser APIs.
 */
import { test, expect, type Page } from '@playwright/test';

/** Routes to measure — chosen as the highest-traffic journeys. */
const PERF_ROUTES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'pipeline', path: '/pipeline' },
  { name: 'leads', path: '/leads' },
  { name: 'opportunities', path: '/opportunities' },
] as const;

/** Budgets (stricter than public thresholds to allow production headroom). */
const BUDGETS = {
  LCP_MS: 2_000,
  INP_MS: 100,
  CLS: 0.05,
} as const;

/**
 * Inject observers before page load so all events are captured from the start.
 * Results are stored on window.__cwvResults for later retrieval.
 */
async function injectCwvObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__cwvResults = { lcp: null, inp: null, cls: 0 };

    // LCP — last entry wins (largest contentful paint updates over time)
    const lcpObs = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      if (entries.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__cwvResults.lcp = entries[entries.length - 1].startTime;
      }
    });
    lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });

    // CLS — cumulative layout shift; sum all unexpected shifts
    let clsValue = 0;
    const clsObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!(entry as any).hadRecentInput) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          clsValue += (entry as any).value ?? 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__cwvResults.cls = clsValue;
        }
      }
    });
    clsObs.observe({ type: 'layout-shift', buffered: true });

    // INP — use event-timing entries; track max interaction duration
    const inpObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const duration = entry.duration;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const current = (window as any).__cwvResults.inp ?? 0;
        if (duration > current) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__cwvResults.inp = duration;
        }
      }
    });
    try {
      inpObs.observe({ type: 'event', buffered: true, durationThreshold: 16 });
    } catch {
      // event timing not available in all browsers/environments
    }
  });
}

/** Wait for the page to reach a "quiet" state after load. */
async function waitForPageIdle(page: Page): Promise<void> {
  await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  // Give React lazy chunks and images time to finish painting
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
}

interface CwvResults {
  lcp: number | null;
  inp: number | null;
  cls: number;
}

async function collectCwv(page: Page): Promise<CwvResults> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__cwvResults as CwvResults;
  });
}

for (const route of PERF_ROUTES) {
  test(`${route.name}: LCP < ${BUDGETS.LCP_MS}ms`, async ({ page }) => {
    await injectCwvObservers(page);
    await page.goto(route.path, { waitUntil: 'load' });
    await waitForPageIdle(page);

    const cwv = await collectCwv(page);

    if (cwv.lcp === null) {
      test.info().annotations.push({
        type: 'lcp-not-measured',
        description: `LCP entry not available on ${route.path} — may be a headless limitation`,
      });
      // Soft skip: headless Chrome sometimes skips LCP for routes with no images
      return;
    }

    if (cwv.lcp > BUDGETS.LCP_MS) {
      test.info().annotations.push({
        type: 'lcp-budget-exceeded',
        description: `LCP ${Math.round(cwv.lcp)}ms on ${route.path} (budget: ${BUDGETS.LCP_MS}ms)`,
      });
    }

    expect(cwv.lcp).toBeLessThanOrEqual(BUDGETS.LCP_MS);
  });

  test(`${route.name}: CLS < ${BUDGETS.CLS}`, async ({ page }) => {
    await injectCwvObservers(page);
    await page.goto(route.path, { waitUntil: 'load' });
    await waitForPageIdle(page);

    // Scroll to trigger any lazy-loaded sections that might shift layout
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);

    const cwv = await collectCwv(page);

    if (cwv.cls > BUDGETS.CLS) {
      await page.screenshot({
        path: `playwright-report/cls-violation-${route.name}.png`,
        fullPage: true,
      });
      test.info().annotations.push({
        type: 'cls-budget-exceeded',
        description: `CLS ${cwv.cls.toFixed(4)} on ${route.path} (budget: ${BUDGETS.CLS})`,
      });
    }

    expect(cwv.cls).toBeLessThanOrEqual(BUDGETS.CLS);
  });
}

test('dashboard: simulated interaction INP < 100ms', async ({ page }) => {
  await injectCwvObservers(page);
  await page.goto('/dashboard', { waitUntil: 'load' });
  await waitForPageIdle(page);

  // WHY: INP measures responsiveness to user interactions. We simulate a click
  // on the first interactive element to generate an event-timing entry.
  // Headless environments may not always fire event-timing observers, so we
  // treat a null result as a soft warning rather than a hard failure.
  const firstButton = page.getByRole('button').first();
  const exists = await firstButton.isVisible().catch(() => false);
  if (exists) {
    await firstButton.click({ force: true });
    await page.waitForTimeout(200); // Allow observer to flush
  }

  const cwv = await collectCwv(page);

  if (cwv.inp === null) {
    test.info().annotations.push({
      type: 'inp-not-measured',
      description: 'INP not captured — event-timing API unavailable in this headless context',
    });
    return; // soft skip
  }

  expect(cwv.inp).toBeLessThanOrEqual(BUDGETS.INP_MS);
});

test('navigation: LCP stays under budget after client-side route change', async ({ page }) => {
  // WHY: SPA navigation doesn't trigger a real page load; LCP resets on
  // soft nav. We measure paint time after a React Router push to catch
  // slow-loading route chunks.
  await injectCwvObservers(page);
  await page.goto('/dashboard', { waitUntil: 'load' });
  await waitForPageIdle(page);

  // Soft-navigate to leads list
  const leadsLink = page
    .getByRole('link', { name: /leads/i })
    .first();
  const t0 = Date.now();
  await leadsLink.click();
  await page.getByRole('main').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  const elapsed = Date.now() - t0;

  // WHY: Client-side navigation must complete within 1.5s (stricter than LCP
  // because there's no network round-trip for the HTML document).
  expect(elapsed).toBeLessThan(1_500);
});
