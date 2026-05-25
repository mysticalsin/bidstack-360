/**
 * ContactDetailPage POM
 *
 * Covers /contacts/:id — the contact 360° view.
 * Sections: header, opportunities list, tasks list, notes list,
 * custom fields panel, email thread.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class ContactDetailPage {
  readonly page: Page;
  readonly main: Locator;
  readonly nameHeading: Locator;
  readonly opportunitiesSection: Locator;
  readonly tasksSection: Locator;
  readonly notesSection: Locator;
  readonly editButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.getByRole('main');
    this.nameHeading = this.main.getByRole('heading', { level: 1 });
    this.opportunitiesSection = this.main.getByRole('heading', { name: 'Opportunities' });
    this.tasksSection = this.main.getByRole('heading', { name: 'Tasks' });
    this.notesSection = this.main.getByRole('heading', { name: 'Notes' });
    this.editButton = this.main.getByRole('button', { name: /edit/i });
  }

  async navigate(contactId: string): Promise<void> {
    await this.page.goto(`/contacts/${contactId}`, { waitUntil: 'load' });
    await expect(this.main).toBeVisible({ timeout: 10_000 });
  }

  async assertFullDetailVisible(): Promise<void> {
    await expect(this.nameHeading).toBeVisible({ timeout: 15_000 });
    await expect(this.opportunitiesSection).toBeVisible();
    await expect(this.tasksSection).toBeVisible();
    await expect(this.notesSection).toBeVisible();
  }

  async clickEdit(): Promise<void> {
    await this.editButton.click();
  }

  /** Returns the contact name from the h1 heading. */
  async getName(): Promise<string> {
    return (await this.nameHeading.innerText()).trim();
  }
}
