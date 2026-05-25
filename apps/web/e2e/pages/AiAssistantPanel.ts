/**
 * AiAssistantPanel POM
 *
 * Covers the Cmd+K command palette / AI assistant panel.
 * Integrates with the mocked Dust API so no real AI calls are made in E2E.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class AiAssistantPanel {
  readonly page: Page;
  readonly dialog: Locator;
  readonly input: Locator;
  readonly resultList: Locator;
  readonly aiDraftSection: Locator;
  readonly useDraftButton: Locator;
  readonly closeButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dialog = page.getByRole('dialog');
    this.input = page.getByRole('combobox', { name: /search|command|ask/i })
      .or(page.getByRole('textbox', { name: /search|command|ask/i }))
      .first();
    this.resultList = page.getByRole('listbox').or(page.locator('[data-testid="cmd-results"]'));
    this.aiDraftSection = page.getByText(/ai draft|draft email|generated/i).first();
    this.useDraftButton = page.getByRole('button', { name: /use draft|insert draft|apply/i });
    this.closeButton = page.getByRole('button', { name: /close|dismiss/i });
  }

  async open(): Promise<void> {
    await this.page.keyboard.press('Control+K');
    await expect(this.dialog).toBeVisible({ timeout: 5_000 });
  }

  async openMac(): Promise<void> {
    await this.page.keyboard.press('Meta+K');
    await expect(this.dialog).toBeVisible({ timeout: 5_000 });
  }

  async typeQuery(query: string): Promise<void> {
    await this.input.fill(query);
  }

  async selectFirstResult(): Promise<void> {
    const first = this.resultList.getByRole('option').first();
    await expect(first).toBeVisible({ timeout: 5_000 });
    await first.click();
  }

  async navigateTo(destination: string): Promise<void> {
    await this.typeQuery(destination);
    await this.page.keyboard.press('Enter');
  }

  async assertDraftVisible(): Promise<void> {
    await expect(this.aiDraftSection).toBeVisible({ timeout: 15_000 });
  }

  async useDraft(): Promise<void> {
    await this.useDraftButton.click();
  }

  async close(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await expect(this.dialog).not.toBeVisible({ timeout: 3_000 });
  }
}
