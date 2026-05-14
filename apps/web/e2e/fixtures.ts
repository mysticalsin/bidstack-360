import { test as base, expect, request as pwRequest } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

/**
 * Wait for the API to become healthy.
 * Called once per worker via worker-scoped fixture.
 */
async function probeApiHealth(): Promise<boolean> {
  try {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${API_URL}/health`, { timeout: 5_000 });
    const ok = res.ok();
    await ctx.dispose();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Custom test fixture that guarantees the API is reachable before any
 * test runs, and provides a typed `gotoAndWait` helper.
 */
export const test = base.extend<{
  gotoAndWait: (path: string) => Promise<void>;
}>({
  gotoAndWait: async ({ page }, use) => {
    // Playwright fixture callback — not a React Hook.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(async (path: string) => {
      // 'load' waits for the main JS bundle; lazy chunks are fetched by
      // React Router afterwards. We then wait for #main to be visible
      // (AppShell renders it immediately) so downstream assertions can
      // target page-specific content with their own timeouts.
      await page.goto(path, { waitUntil: 'load' });
      await page.locator('#main').waitFor({ state: 'visible', timeout: 10_000 });
    });
  },
});

test.beforeAll(async () => {
  const healthy = await probeApiHealth();
  test.skip(!healthy, `API at ${API_URL} not reachable — skipping E2E suite`);
});

export { expect };
