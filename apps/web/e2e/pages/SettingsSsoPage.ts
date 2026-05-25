/**
 * SettingsSsoPage POM
 *
 * Covers /settings with SSO / security section. Checks SAML/OIDC
 * configuration panels are renderable and that the domain enforcement toggle
 * is accessible to admin users.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class SettingsSsoPage {
  readonly page: Page;
  readonly ssoSection: Locator;
  readonly samlToggle: Locator;
  readonly domainField: Locator;
  readonly saveButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.ssoSection = page.getByText(/sso|single sign-on|saml|oidc/i).first();
    this.samlToggle = page.getByRole('switch', { name: /saml|sso/i });
    this.domainField = page.getByRole('textbox', { name: /domain|idp|entity id/i });
    this.saveButton = page.getByRole('button', { name: /save|apply/i });
  }

  async navigate(): Promise<void> {
    await this.page.goto('/settings', { waitUntil: 'load' });
    await expect(this.page.getByRole('heading', { name: /settings/i, level: 1 })).toBeVisible({
      timeout: 10_000,
    });
  }

  async openSsoSection(): Promise<void> {
    const ssoNav = this.page.getByRole('button', { name: /sso|security|authentication/i });
    if (await ssoNav.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await ssoNav.click();
    }
    // If already on the right tab, ssoSection is visible directly
    await expect(
      this.ssoSection.or(this.page.getByText(/sso is not configured/i)).first(),
    ).toBeVisible({ timeout: 10_000 });
  }

  async isSsoSectionAvailable(): Promise<boolean> {
    return this.ssoSection.isVisible({ timeout: 3_000 }).catch(() => false);
  }
}
