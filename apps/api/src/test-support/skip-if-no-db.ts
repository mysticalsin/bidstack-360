// Shared fail-loud DB-dependent test guard.
//
// WHY: a test body that does `if (!dbReachable) return;` (or `console.warn` +
// return) reports PASSED when the DB is unreachable — a CI run without
// Postgres would go green while the entire integration suite silently never
// executed (violates repo Rule 12: fail loud). Throwing turns "DB
// unreachable" into a visible test failure instead of a false pass. Pattern
// lifted from account-intel.integration.test.ts, which every other
// integration suite in this repo already follows.

import { it } from 'vitest';

/**
 * Build a `skipIfNoDb(name, fn)` wrapper bound to this file's readiness
 * check. `isReady` is called at test-run time (not captured once), so it
 * reflects whatever `beforeAll` set after this factory runs.
 */
export function makeSkipIfNoDb(isReady: () => boolean) {
  return (name: string, fn: () => Promise<void> | void): void => {
    it(name, async () => {
      if (!isReady()) {
        throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
      }
      await fn();
    });
  };
}
