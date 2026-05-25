/**
 * database.fixture.ts
 *
 * WHY: Each E2E test that writes data must start from a clean, known state.
 * A polluted DB from a previous test run causes false failures that are hard
 * to debug (flaky tests violate Rule 12 — fail loud).
 *
 * This fixture calls pnpm db:seed:e2e (via the API's /e2e/reset endpoint in
 * CI) to reset to a deterministic seed before the suite. In local dev it
 * uses the same endpoint if available, or skips gracefully.
 */
import { test as base, request as pwRequest } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4010';

async function resetDatabase(): Promise<boolean> {
  try {
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${API_URL}/e2e/reset-seed`, { timeout: 30_000 });
    await ctx.dispose();
    return res.ok();
  } catch {
    // Endpoint may not be available in production — degrade gracefully.
    return false;
  }
}

export type DatabaseFixtures = {
  /** Resets the DB to e2e seed state. Returns true if reset succeeded. */
  resetDb: () => Promise<boolean>;
};

export const test = base.extend<DatabaseFixtures>({
  resetDb: async (_, runReset) => {
    await runReset(async () => {
      const ok = await resetDatabase();
      return ok;
    });
  },
});

export { expect } from '@playwright/test';
