/**
 * DealDetailPage POM
 *
 * Covers /opportunities/:id — the opportunity/deal 360° view.
 * Sections: Intel ribbon, activity tab, tasks tab, win-prediction score,
 * stage move, mark won/lost.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class DealDetailPage {
  readonly page: Page;
  readonly main: Locator;
  readonly stageSelector: Locator;
  readonly winPrediction: Locator;
  readonly activityTab: Locator;
  readonly tasksTab: Locator;
  readonly markWonButton: Locator;
  readonly markLostButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.locator('#main');
    this.stageSelector = page.getByRole('combobox', { name: /stage/i });
    this.winPrediction = page.getByText(/win prediction/i);
    this.activityTab = page.getByRole('tab', { name: /activity/i });
    this.tasksTab = page.getByRole('tab', { name: /tasks/i });
    this.markWonButton = page.getByRole('button', { name: /mark (as )?won/i });
    this.markLostButton = page.getByRole('button', { name: /mark (as )?lost/i });
  }

  async navigate(opportunityId: string): Promise<void> {
    await this.page.goto(`/opportunities/${opportunityId}`, { waitUntil: 'load' });
    await expect(this.main).toBeVisible({ timeout: 10_000 });
  }

  async assertIntelRibbonVisible(): Promise<void> {
    await expect(
      this.page.getByText(/win prediction|financial health|triggers/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  }

  async clickActivityTab(): Promise<void> {
    await this.activityTab.click();
    await expect(
      this.page.getByRole('listitem').or(this.page.getByText(/no activities/i)).first(),
    ).toBeVisible({ timeout: 10_000 });
  }

  async logActivity(note: string): Promise<void> {
    const addButton = this.page.getByRole('button', { name: /log activity|add activity|new note/i });
    await addButton.click();
    const textarea = this.page.getByRole('textbox').last();
    await textarea.fill(note);
    await this.page.getByRole('button', { name: /save|submit|add/i }).click();
  }

  async markWon(): Promise<void> {
    await this.markWonButton.click();
    // Confirm dialog if present
    const confirmBtn = this.page.getByRole('button', { name: /confirm|yes|mark won/i });
    if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
  }

  async markLost(): Promise<void> {
    await this.markLostButton.click();
    const confirmBtn = this.page.getByRole('button', { name: /confirm|yes|mark lost/i });
    if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
  }
}
