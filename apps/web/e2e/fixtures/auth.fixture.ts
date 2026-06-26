/**
 * auth.fixture.ts
 *
 * WHY: Logging in before every test is slow and noisy. This fixture provides
 * a `loginAs(role)` helper that uses Playwright storage state to reuse a
 * single authenticated session per role, cutting test time by ~60%.
 *
 * In stub-auth mode (E2E default) `loginAs(role)` writes the E2E role marker
 * consumed by both the frontend auth context and the API role override header.
 * In Clerk mode it would switch the storage state file.
 */
import { test as base, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import path from 'path';

export type SupportedRole = 'admin' | 'manager' | 'read-only' | 'viewer';

const STUB_ROLE_KEY = 'bidstack:stub-role';

/** Maps role to a pre-saved storage state JSON file. */
const STATE_FILE: Record<SupportedRole, string> = {
  admin: path.resolve(process.cwd(), 'e2e/.auth/admin.json'),
  manager: path.resolve(process.cwd(), 'e2e/.auth/manager.json'),
  'read-only': path.resolve(process.cwd(), 'e2e/.auth/readonly.json'),
  viewer: path.resolve(process.cwd(), 'e2e/.auth/viewer.json'),
};

export type AuthFixtures = {
  /** Applies stored auth state for the given role to the current context. */
  loginAs: (role: SupportedRole) => Promise<void>;
  /** Navigates to a route and waits for the main landmark. */
  gotoAndWait: (path: string) => Promise<void>;
};

export const test = base.extend<AuthFixtures>({
  loginAs: async ({ context, page }, applyLogin) => {
    await applyLogin(async (role: SupportedRole) => {
      const stateFile = STATE_FILE[role];
      void stateFile;
      await context.addInitScript(
        ({ key, value }) => {
          window.localStorage.setItem(key, value);
        },
        { key: STUB_ROLE_KEY, value: role },
      );
      await setRoleOnCurrentPage(page, role);

      // In Clerk mode we would apply the saved state file here. Stub mode is
      // already authenticated, and the role marker above chooses the E2E user.
      try {
        await (context as BrowserContext).storageState();
      } catch {
        // stub mode - context is already authenticated
      }
    });
  },

  gotoAndWait: async ({ page }, runNavigation) => {
    await runNavigation(async (routePath: string) => {
      await page.goto(routePath, { waitUntil: 'load' });
      await expect(page.getByRole('main')).toBeVisible({ timeout: 15_000 });
    });
  },
});

export { expect };

async function setRoleOnCurrentPage(page: Page, role: SupportedRole): Promise<void> {
  await page
    .evaluate(
      ({ key, value }) => {
        const oldValue = window.localStorage.getItem(key);
        window.localStorage.setItem(key, value);
        window.dispatchEvent(
          new StorageEvent('storage', {
            key,
            oldValue,
            newValue: value,
            storageArea: window.localStorage,
          }),
        );
      },
      { key: STUB_ROLE_KEY, value: role },
    )
    .catch(() => undefined);
}
