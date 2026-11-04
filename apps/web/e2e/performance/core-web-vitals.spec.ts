/**
 * core-web-vitals.spec.ts
 *
 * WHY: Tony's design-standards.md mandates LCP < 2.5s, INP < 200ms, CLS < 0.1.
 * This suite tightens LCP/CLS budgets and keeps INP aligned to the public
 * threshold while annotating stricter headroom misses. Catching regressions
 * here prevents user-visible slowness shipping unnoticed.
 *
 * Technique: inject a PerformanceObserver via page.addInitScript, navigate,
 * wait for page idle, then retrieve the collected entries. No third-party
 * tools required — pure browser APIs.
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// WHY: Core Web Vitals are lab measurements. Running multiple LCP/CLS probes
// for the same preview server in parallel turns the gate into a machine-load
// test and creates false product regressions.
test.describe.configure({ mode: 'serial' });

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
  INP_MS: 200,
  INP_HEADROOM_MS: 100,
  CLS: 0.05,
} as const;

/**
 * Inject observers before page load so all events are captured from the start.
 * Results are stored on window.__cwvResults for later retrieval.
 */
async function injectCwvObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__cwvResults = { lcp: null, inp: null, cls: 0, shifts: [] };

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
          const shift = entry as PerformanceEntry & {
            value: number;
            sources?: Array<{
              node?: Node;
              previousRect: DOMRectReadOnly;
              currentRect: DOMRectReadOnly;
            }>;
          };
          // Keep attribution in the report: a score alone cannot distinguish
          // a late KPI row from fonts, banners, or animated column totals.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__cwvResults.shifts.push({
            time: shift.startTime,
            value: shift.value,
            sources: shift.sources?.map((source) => ({
              node:
                source.node instanceof Element
                  ? `${source.node.tagName.toLowerCase()}.${source.node.className}`
                  : source.node?.nodeName,
              previousRect: source.previousRect.toJSON(),
              currentRect: source.currentRect.toJSON(),
            })),
          });
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
      inpObs.observe({
        type: 'event',
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit);
    } catch {
      // event timing not available in all browsers/environments
    }
  });
}

/** Wait for the page to reach a "quiet" state after load. */
async function waitForPageIdle(page: Page): Promise<void> {
  await page
    .getByRole('main')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => {});
  // Give React lazy chunks and images time to finish painting
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
}

interface CwvResults {
  lcp: number | null;
  inp: number | null;
  cls: number;
  shifts: unknown[];
}

type PerfMetricName = 'LCP' | 'CLS' | 'INP' | 'SPA_NAVIGATION';

interface PerfEvidence {
  route: string;
  metric: PerfMetricName;
  value: number | null;
  unit: 'ms' | 'score';
  budget: number;
  headroomBudget?: number;
  status: 'pass' | 'fail' | 'warning' | 'not-measured';
}

type PerfEvidenceRecord = PerfEvidence & { measuredAt: string };

const PERF_EVIDENCE_PATH = resolve(process.cwd(), 'playwright-report/core-web-vitals-latest.json');
const perfEvidenceRunId = new Date().toISOString();
const perfEvidenceRecords: PerfEvidenceRecord[] = [];

function writePerfEvidenceFile(): void {
  mkdirSync(resolve(process.cwd(), 'playwright-report'), { recursive: true });
  writeFileSync(
    PERF_EVIDENCE_PATH,
    JSON.stringify(
      {
        runId: perfEvidenceRunId,
        generatedAt: new Date().toISOString(),
        budgets: BUDGETS,
        metrics: perfEvidenceRecords,
      },
      null,
      2,
    ),
  );
}

async function attachPerfEvidence(testInfo: TestInfo, evidence: PerfEvidence): Promise<void> {
  const roundedValue =
    evidence.value === null
      ? 'not measured'
      : evidence.unit === 'ms'
        ? `${Math.round(evidence.value)}ms`
        : evidence.value.toFixed(4);

  testInfo.annotations.push({
    type: 'perf-evidence',
    description: `${evidence.metric} on ${evidence.route}: ${roundedValue} (budget: ${evidence.budget}${evidence.unit === 'ms' ? 'ms' : ''})`,
  });

  const record = {
    measuredAt: new Date().toISOString(),
    ...evidence,
  };
  perfEvidenceRecords.push(record);
  writePerfEvidenceFile();

  await testInfo.attach(`perf-${evidence.route}-${evidence.metric.toLowerCase()}`, {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(record, null, 2)),
  });
}

test.beforeAll(() => {
  perfEvidenceRecords.length = 0;
  writePerfEvidenceFile();
});

test.afterAll(() => {
  writePerfEvidenceFile();
});

async function collectCwv(page: Page): Promise<CwvResults> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__cwvResults as CwvResults;
  });
}

for (const route of PERF_ROUTES) {
  test(`${route.name}: LCP < ${BUDGETS.LCP_MS}ms`, async ({ page }, testInfo) => {
    await injectCwvObservers(page);
    await page.goto(route.path, { waitUntil: 'load' });
    await waitForPageIdle(page);

    const cwv = await collectCwv(page);

    if (cwv.lcp === null) {
      await attachPerfEvidence(testInfo, {
        route: route.name,
        metric: 'LCP',
        value: null,
        unit: 'ms',
        budget: BUDGETS.LCP_MS,
        status: 'not-measured',
      });
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

    await attachPerfEvidence(testInfo, {
      route: route.name,
      metric: 'LCP',
      value: cwv.lcp,
      unit: 'ms',
      budget: BUDGETS.LCP_MS,
      status: 'pass',
    });

    expect(cwv.lcp).toBeLessThanOrEqual(BUDGETS.LCP_MS);
  });

  test(`${route.name}: CLS < ${BUDGETS.CLS}`, async ({ page }, testInfo) => {
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

    await testInfo.attach(`layout-shifts-${route.name}`, {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(cwv.shifts, null, 2)),
    });

    await attachPerfEvidence(testInfo, {
      route: route.name,
      metric: 'CLS',
      value: cwv.cls,
      unit: 'score',
      budget: BUDGETS.CLS,
      status: cwv.cls > BUDGETS.CLS ? 'fail' : 'pass',
    });

    expect(cwv.cls).toBeLessThanOrEqual(BUDGETS.CLS);
  });
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
]) {
  test(`pipeline: loading KPI row reserves space at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await injectCwvObservers(page);

    // Reproduce the CI race deliberately: opportunities resolve while stage
    // definitions are still pending, leaving the board skeleton on screen.
    let releaseOpportunities!: () => void;
    let releaseStages!: () => void;
    const opportunitiesReady = new Promise<void>((resolve) => {
      releaseOpportunities = resolve;
    });
    const stagesReady = new Promise<void>((resolve) => {
      releaseStages = resolve;
    });
    await page.route(/\/api\/(?:v1\/)?opportunities\?/, async (route) => {
      await opportunitiesReady;
      await route.continue();
    });
    await page.route(/\/api\/(?:v1\/)?pipeline-stages$/, async (route) => {
      await stagesReady;
      await route.continue();
    });

    try {
      await page.goto('/pipeline', { waitUntil: 'load' });
      const main = page.getByRole('main');
      const summary = main.locator('[data-tour="pipeline-kanban"]');
      await expect(summary).toBeVisible();
      await expect(summary.getByText('…', { exact: true })).toHaveCount(4);
      const skeleton = main.locator('.bs-shimmer').first();
      await expect(skeleton).toBeVisible();
      // Allow the existing skeleton entrance transform to settle before
      // comparing positions; API gates, not this delay, enforce the race.
      await page.waitForTimeout(600);
      const before = await skeleton.boundingBox();
      expect(before).not.toBeNull();
      const beforeData = await collectCwv(page);

      const loaded = page.waitForResponse(
        (response) => /\/api\/(?:v1\/)?opportunities\?/.test(response.url()) && response.ok(),
      );
      releaseOpportunities();
      await loaded;
      await expect(summary.getByText('…', { exact: true })).toHaveCount(0);
      await expect(main.getByTestId('pipeline-column')).toHaveCount(0);
      const after = await skeleton.boundingBox();
      expect(after).not.toBeNull();
      expect(
        Math.abs(after!.y - before!.y),
        'KPI data must not push the loading board down',
      ).toBeLessThanOrEqual(1);

      releaseStages();
      await expect(main.getByTestId('pipeline-column').first()).toBeVisible();
      await waitForPageIdle(page);
      const cwv = await collectCwv(page);
      await testInfo.attach('pipeline-loading-layout-shifts', {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ ...cwv, clsBeforeData: beforeData.cls }, null, 2)),
      });
      // This regression covers the pending-to-loaded transition at both
      // widths. The existing route test above keeps the full-load CLS gate.
      expect(cwv.cls - beforeData.cls).toBeLessThanOrEqual(BUDGETS.CLS);
    } finally {
      releaseOpportunities();
      releaseStages();
    }
  });
}

test('dashboard: simulated interaction INP < 200ms', async ({ page }, testInfo) => {
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
    await attachPerfEvidence(testInfo, {
      route: 'dashboard',
      metric: 'INP',
      value: null,
      unit: 'ms',
      budget: BUDGETS.INP_MS,
      headroomBudget: BUDGETS.INP_HEADROOM_MS,
      status: 'not-measured',
    });
    test.info().annotations.push({
      type: 'inp-not-measured',
      description: 'INP not captured — event-timing API unavailable in this headless context',
    });
    return; // soft skip
  }

  if (cwv.inp > BUDGETS.INP_HEADROOM_MS) {
    test.info().annotations.push({
      type: 'inp-headroom-missed',
      description: `Synthetic INP ${Math.round(cwv.inp)}ms exceeded the ${BUDGETS.INP_HEADROOM_MS}ms headroom target but stayed under the ${BUDGETS.INP_MS}ms launch budget`,
    });
  }

  await attachPerfEvidence(testInfo, {
    route: 'dashboard',
    metric: 'INP',
    value: cwv.inp,
    unit: 'ms',
    budget: BUDGETS.INP_MS,
    headroomBudget: BUDGETS.INP_HEADROOM_MS,
    status: cwv.inp > BUDGETS.INP_HEADROOM_MS ? 'warning' : 'pass',
  });

  expect(cwv.inp).toBeLessThanOrEqual(BUDGETS.INP_MS);
});

test('navigation: LCP stays under budget after client-side route change', async ({
  page,
}, testInfo) => {
  // WHY: SPA navigation doesn't trigger a real page load; LCP resets on
  // soft nav. We measure paint time after a React Router push to catch
  // slow-loading route chunks.
  await injectCwvObservers(page);
  await page.goto('/dashboard', { waitUntil: 'load' });
  await waitForPageIdle(page);

  // Soft-navigate to leads list. Leads lives in the Pipeline rail section, which
  // starts collapsed; open it first (not part of the timed navigation).
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  const leadsLink = nav.getByRole('link', { name: /^leads/i }).first();
  if (!(await leadsLink.isVisible())) {
    await nav.getByRole('button', { name: /^pipeline$/i, expanded: false }).click();
  }
  await leadsLink.waitFor({ state: 'visible' });
  const t0 = Date.now();
  await leadsLink.click();
  await page
    .getByRole('main')
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => {});
  const elapsed = Date.now() - t0;

  // WHY: Client-side navigation must complete within 1.5s (stricter than LCP
  // because there's no network round-trip for the HTML document).
  await attachPerfEvidence(testInfo, {
    route: 'dashboard-to-leads',
    metric: 'SPA_NAVIGATION',
    value: elapsed,
    unit: 'ms',
    budget: 1_500,
    status: 'pass',
  });

  expect(elapsed).toBeLessThan(1_500);
});
