/**
 * LoginPage POM
 *
 * In stub-auth mode (E2E default) the app bypasses the real login screen and
 * auto-authenticates. This POM still models the login entry-point so that
 * tests can exercise both paths when Clerk keys are present.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByRole('textbox', { name: /email/i });
    this.passwordInput = page.getByLabel(/password/i);
    this.submitButton = page.getByRole('button', { name: /sign in|log in/i });
    this.errorMessage = page.getByRole('alert');
  }

  async navigate(): Promise<void> {
    await this.page.goto('/login', { waitUntil: 'load' });
  }

  async loginWith(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  /** True if we land on the app shell rather than a login form. */
  async isInStubAuthMode(): Promise<boolean> {
    await this.page.goto('/', { waitUntil: 'load' });
    // Stub mode redirects / → /dashboard immediately without a login screen.
    return this.page.url().includes('/dashboard') || this.page.url().includes('/pipeline');
  }

  async assertLoginError(): Promise<void> {
    await expect(this.errorMessage).toBeVisible({ timeout: 10_000 });
  }
}
