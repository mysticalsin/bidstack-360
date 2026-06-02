/**
 * IntegrationsPage POM
 *
 * Covers /integrations — list of connectors (Gmail, Slack, MS Teams, etc.)
 * and per-integration OAuth connect/disconnect flow.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class IntegrationsPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly gmailCard: Locator;
  readonly slackCard: Locator;
  readonly microsoftCard: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: /integrations/i, level: 1 });
    this.gmailCard = page.locator('[data-testid="integration-card-gmail"]');
    this.slackCard = page.locator('[data-testid="integration-card-slack"]');
    this.microsoftCard = page.locator('[data-testid="integration-card-microsoft"]');
  }

  async navigate(): Promise<void> {
    await this.page.goto('/integrations', { waitUntil: 'load' });
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
  }

  async assertIntegrationCardsVisible(): Promise<void> {
    await expect(this.gmailCard.or(this.slackCard).or(this.microsoftCard).first()).toBeVisible({
      timeout: 10_000,
    });
  }

  /** Click the Connect button for a specific integration by name. */
  async connectIntegration(name: string): Promise<void> {
    const card = this.page.locator(`[data-testid="integration-card-${name.toLowerCase()}"]`);
    const connectBtn = card.getByRole('button', { name: /connect/i });
    await connectBtn.click();
  }

  async assertConnected(name: string): Promise<void> {
    const card = this.page.locator(`[data-testid="integration-card-${name.toLowerCase()}"]`);
    await expect(card.getByText(/connected|active/i)).toBeVisible({ timeout: 10_000 });
  }
}
