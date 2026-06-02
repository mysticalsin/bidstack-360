/**
 * CustomObjectsAdminPage POM
 *
 * Covers /settings/custom-objects (admin only).
 * Allows defining new entity types, fields, and relations on top of the
 * CustomObjectDef / CustomObjectRecord Prisma models.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class CustomObjectsAdminPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly newObjectButton: Locator;
  readonly objectList: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: /custom objects|object types/i, level: 1 });
    this.newObjectButton = page.getByRole('button', {
      name: /new object|add object|create object/i,
    });
    this.objectList = page.locator('[data-testid="custom-object-list"], table tbody');
  }

  async navigate(): Promise<void> {
    await this.page.goto('/settings/custom-objects', { waitUntil: 'load' });
  }

  async isAvailable(): Promise<boolean> {
    return this.heading.isVisible({ timeout: 5_000 }).catch(() => false);
  }

  async createObject(opts: { name: string; pluralName: string }): Promise<void> {
    await this.newObjectButton.click();
    await this.page.getByRole('textbox', { name: /singular|object name|name/i }).fill(opts.name);
    const pluralInput = this.page.getByRole('textbox', { name: /plural/i });
    if (await pluralInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await pluralInput.fill(opts.pluralName);
    }
    const createResponse = this.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/api/v1/custom-objects'),
    );
    await this.page.getByRole('button', { name: /create|save/i }).click();
    const response = await createResponse;
    expect(response.ok(), await response.text()).toBe(true);
    const created = (await response.json()) as { key: string; labelSingular: string };
    expect(created.labelSingular).toBe(opts.name);
    await expect(this.page.getByRole('dialog', { name: /new custom object/i })).toBeHidden({
      timeout: 10_000,
    });
    await expect(this.page.getByTestId(`custom-object-${created.key}`)).toBeVisible({
      timeout: 15_000,
    });
  }

  async addFieldToObject(
    objectName: string,
    fieldOpts: { label: string; type: string },
  ): Promise<void> {
    const row = this.page.getByText(new RegExp(objectName, 'i')).locator('..').locator('..');
    await row.getByRole('button', { name: /edit|manage fields/i }).click();
    await this.page.getByRole('button', { name: /add field/i }).click();
    await this.page.getByRole('textbox', { name: /field label|label/i }).fill(fieldOpts.label);
    const typeSelect = this.page.getByRole('combobox', { name: /field type|type/i });
    await typeSelect.selectOption({ label: fieldOpts.type });
    await this.page.getByRole('button', { name: /save|add/i }).click();
  }
}
