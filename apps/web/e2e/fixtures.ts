import { test as base, expect, request as pwRequest } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4010';

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
      // React Router afterwards. We then wait for the semantic main
      // landmark so downstream assertions can target page-specific
      // content with their own timeouts.
      await page.goto(path, { waitUntil: 'load' });
      await page.getByRole('main').waitFor({ state: 'visible' });
    });
  },
});

test.beforeAll(async () => {
  const healthy = await probeApiHealth();
  if (!healthy) {
    throw new Error(`API at ${API_URL} not reachable — aborting E2E suite. (Rule 12: Fail loud)`);
  }
});

export { expect };
