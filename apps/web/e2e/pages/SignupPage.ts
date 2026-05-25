/**
 * SignupPage POM
 *
 * Models the /sign-up route. In Clerk production mode this is the real Clerk
 * signup widget. In stub-auth mode (E2E default) the route doesn't exist and
 * tests skip. Guards included so CI doesn't false-fail.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class SignupPage {
  readonly page: Page;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.firstNameInput = page.getByRole('textbox', { name: /first name/i });
    this.lastNameInput = page.getByRole('textbox', { name: /last name/i });
    this.emailInput = page.getByRole('textbox', { name: /email/i });
    this.passwordInput = page.getByLabel(/password/i);
    this.submitButton = page.getByRole('button', { name: /sign up|create account|continue/i });
  }

  async navigate(): Promise<void> {
    await this.page.goto('/sign-up', { waitUntil: 'load' });
  }

  /** Returns true if the signup form is rendered (Clerk mode only). */
  async isRendered(): Promise<boolean> {
    try {
      await this.page.waitForURL(/\/sign-up/, { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  async fillAndSubmit(opts: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }): Promise<void> {
    await this.firstNameInput.fill(opts.firstName);
    await this.lastNameInput.fill(opts.lastName);
    await this.emailInput.fill(opts.email);
    await this.passwordInput.fill(opts.password);
    await this.submitButton.click();
  }

  async assertVerificationStep(): Promise<void> {
    await expect(
      this.page.getByText(/verify|check your email|verification code/i),
    ).toBeVisible({ timeout: 15_000 });
  }
}
