/**
 * WorkflowBuilderPage POM
 *
 * Covers /workflows (list) and /workflows/:id (builder canvas).
 * Workflows use a trigger + condition + action model rendered as a
 * visual node graph.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class WorkflowBuilderPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly newWorkflowButton: Locator;
  readonly triggerPanel: Locator;
  readonly actionPanel: Locator;
  readonly saveButton: Locator;
  readonly activateToggle: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: /workflow/i, level: 1 });
    this.newWorkflowButton = page
      .getByRole('button', { name: /new workflow|create workflow/i })
      .first();
    this.triggerPanel = page.getByText(/trigger|when/i).first();
    this.actionPanel = page.getByText(/action|then do/i).first();
    this.saveButton = page.getByRole('button', { name: /save workflow|save/i });
    this.activateToggle = page.getByRole('switch', { name: /active|enabled/i });
  }

  async navigate(): Promise<void> {
    await this.page.goto('/workflows', { waitUntil: 'load' });
  }

  async isAvailable(): Promise<boolean> {
    return this.heading.isVisible({ timeout: 5_000 }).catch(() => false);
  }

  async openNewWorkflow(): Promise<void> {
    await this.newWorkflowButton.click();
    await expect(this.triggerPanel.or(this.saveButton)).toBeVisible({ timeout: 10_000 });
  }

  async selectTrigger(triggerLabel: string): Promise<void> {
    await this.page.getByRole('button', { name: /select trigger|add trigger/i }).click();
    await this.page.getByRole('option', { name: new RegExp(triggerLabel, 'i') }).click();
  }

  async addAction(actionLabel: string): Promise<void> {
    await this.page.getByRole('button', { name: /add action/i }).click();
    await this.page.getByRole('option', { name: new RegExp(actionLabel, 'i') }).click();
  }

  async saveWorkflow(): Promise<void> {
    await this.saveButton.click();
    await expect(this.page.getByText(/saved|workflow saved/i)).toBeVisible({ timeout: 10_000 });
  }
}
