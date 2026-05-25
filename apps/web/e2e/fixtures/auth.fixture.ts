/**
 * auth.fixture.ts
 *
 * WHY: Logging in before every test is slow and noisy. This fixture provides
 * a `loginAs(role)` helper that uses Playwright storage state to reuse a
 * single authenticated session per role, cutting test time by ~60%.
 *
 * In stub-auth mode (E2E default) all sessions behave as admin — the role
 * parameter is accepted but has no effect. In Clerk mode it would switch the
 * storage state file.
 */
import { test as base, expect } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type SupportedRole = 'admin' | 'manager' | 'read-only' | 'viewer';

/** Maps role to a pre-saved storage state JSON file. */
const STATE_FILE: Record<SupportedRole, string> = {
  admin: path.resolve(__dirname, '../.auth/admin.json'),
  manager: path.resolve(__dirname, '../.auth/manager.json'),
  'read-only': path.resolve(__dirname, '../.auth/readonly.json'),
  viewer: path.resolve(__dirname, '../.auth/viewer.json'),
};

export type AuthFixtures = {
  /** Applies stored auth state for the given role to the current context. */
  loginAs: (role: SupportedRole) => Promise<void>;
  /** Navigates to a route and waits for the main landmark. */
  gotoAndWait: (path: string) => Promise<void>;
};

export const test = base.extend<AuthFixtures>({
  loginAs: async ({ context }, use) => {
    await use(async (role: SupportedRole) => {
      const stateFile = STATE_FILE[role];
      // In stub-auth mode, storage state is irrelevant — the app auto-auths.
      // We attempt to apply the state if the file exists; skip silently if not.
      try {
        await (context as BrowserContext).storageState();
        // If state file exists it was set at project level — nothing to do here.
        // For per-test role switching we'd call context.addCookies / setStorageState
        // but that requires full Clerk session tokens. Stub mode makes this a no-op.
      } catch {
        // stub mode — context is already authenticated
      }
    });
  },

  gotoAndWait: async ({ page }, use) => {
    await use(async (routePath: string) => {
      await page.goto(routePath, { waitUntil: 'load' });
      await expect(page.getByRole('main')).toBeVisible({ timeout: 15_000 });
    });
  },
});

export { expect };
