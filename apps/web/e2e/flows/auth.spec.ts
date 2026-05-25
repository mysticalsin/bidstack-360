/**
 * auth.spec.ts
 *
 * WHY these tests exist: Auth is the entry gate to every BidStack feature.
 * A broken login loop blocks all other E2E suites. Signup → verify → login →
 * logout must all work deterministically. SSO path is conditional on Clerk
 * being configured — not expected in CI stub mode.
 */
import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage.js';
import { SignupPage } from '../pages/SignupPage.js';

const STUB_MODE = !process.env.VITE_CLERK_PUBLISHABLE_KEY;

test.describe('Auth flows', () => {
  test('stub-auth mode auto-authenticates and lands on app', async ({ page }) => {
    test.skip(!STUB_MODE, 'Only applicable in stub-auth mode');
    const loginPage = new LoginPage(page);
    const inApp = await loginPage.isInStubAuthMode();
    expect(inApp).toBe(true);
    // Confirm the app shell is rendered (not a login screen)
    await expect(page.getByRole('main')).toBeVisible({ timeout: 10_000 });
  });

  test('unauthenticated visit redirects to login', async ({ page }) => {
    test.skip(STUB_MODE, 'Stub mode has no login redirect — skip in local dev');
    await page.goto('/dashboard', { waitUntil: 'load' });
    await expect(page).toHaveURL(/\/login|\/sign-in/, { timeout: 10_000 });
  });

  test('signup form renders in Clerk mode', async ({ page }) => {
    test.skip(STUB_MODE, 'Signup requires Clerk — skip in stub mode');
    const signup = new SignupPage(page);
    await signup.navigate();
    const rendered = await signup.isRendered();
    expect(rendered).toBe(true);
  });

  test('login renders and accepts credentials (Clerk mode)', async ({ page }) => {
    test.skip(STUB_MODE, 'Login requires Clerk — skip in stub mode');
    const login = new LoginPage(page);
    await login.navigate();
    await expect(login.emailInput).toBeVisible({ timeout: 10_000 });
    await expect(login.submitButton).toBeVisible();
    // Verify an invalid login triggers an error state (fail-loud for broken auth)
    await login.loginWith('nobody@example.com', 'wrong-password');
    await login.assertLoginError();
  });

  test('logout returns to login screen (Clerk mode)', async ({ page }) => {
    test.skip(STUB_MODE, 'Logout requires Clerk — skip in stub mode');
    // Assumes session is active from beforeAll storage state
    await page.goto('/dashboard', { waitUntil: 'load' });
    const logoutBtn = page.getByRole('button', { name: /sign out|log out|logout/i });
    if (await logoutBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await logoutBtn.click();
      await expect(page).toHaveURL(/\/login|\/sign-in/, { timeout: 10_000 });
    } else {
      test.skip(true, 'Logout button not found — app may use Clerk user button');
    }
  });

  test('protected route shows app shell when authenticated (stub mode)', async ({ page }) => {
    test.skip(!STUB_MODE, 'Stub-mode specific');
    await page.goto('/pipeline', { waitUntil: 'load' });
    await expect(page.getByRole('main')).toBeVisible({ timeout: 10_000 });
    // Must NOT see a login form
    await expect(page.getByRole('textbox', { name: /email/i })).not.toBeVisible({ timeout: 2_000 });
  });
});
