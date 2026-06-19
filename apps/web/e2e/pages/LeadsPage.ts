/**
 * LeadsPage POM
 *
 * Covers /leads list and /leads/new. Also provides helpers for navigating
 * to a specific lead detail. Tests that encode business behaviour
 * (lead scoring, BANT completion, conversion) should use this POM directly
 * rather than duplicating selectors.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class LeadsPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly newLeadButton: Locator;
  readonly leadRows: Locator;
  readonly leadLinks: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'Leads', level: 1 });
    this.newLeadButton = page.getByRole('button', { name: /new lead|add lead/i });
    this.leadRows = page.locator('[data-testid="lead-row"], table tbody tr');
    this.leadLinks = page.locator('a[href^="/leads/"]');
    this.emptyState = page.getByText(/no leads|empty/i);
  }

  async navigate(): Promise<void> {
    await this.page.goto('/leads', { waitUntil: 'load' });
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
  }

  async waitForList(): Promise<void> {
    await expect(this.leadRows.or(this.emptyState).first()).toBeVisible({ timeout: 15_000 });
  }

  async clickFirstLead(): Promise<string> {
    const link = this.leadLinks.first();
    const href = (await link.getAttribute('href')) ?? '';
    await link.click();
    return href;
  }

  async openNewLeadForm(): Promise<void> {
    await this.newLeadButton.click();
    await this.page.waitForURL(/\/leads\/new/, { timeout: 10_000 });
  }

  async assertLeadDetailVisible(namePattern?: RegExp): Promise<void> {
    await expect(this.page.locator('#main')).toBeVisible({ timeout: 10_000 });
    if (namePattern) {
      await expect(this.page.getByRole('heading', { level: 1 })).toHaveText(namePattern);
    }
  }

  /** Fill and submit the new-lead form. Returns the created lead URL. */
  async createLead(opts: {
    firstName: string;
    lastName: string;
    company?: string;
  }): Promise<string> {
    await this.openNewLeadForm();
    await this.page.getByRole('textbox', { name: /first name/i }).fill(opts.firstName);
    await this.page.getByRole('textbox', { name: /last name/i }).fill(opts.lastName);
    if (opts.company) {
      await this.page.getByRole('textbox', { name: /company/i }).fill(opts.company);
    }
    await this.page.getByRole('button', { name: /save|create|submit/i }).click();
    await this.page.waitForURL(/\/leads\/[^/]+$/, { timeout: 15_000 });
    return this.page.url();
  }
}
