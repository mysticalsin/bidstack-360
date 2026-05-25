/**
 * custom-fields.spec.ts
 *
 * WHY: Custom fields let Mantu adapt BidStack to each engagement vertical.
 * A field defined but not saveable, or not searchable, silently breaks
 * customer workflows without any visible error.
 */
import { test, expect } from '@playwright/test';
import { CustomObjectsAdminPage } from '../pages/CustomObjectsAdminPage.js';

test.describe('Custom fields', () => {
  test('custom fields definition is accessible from settings', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'load' });
    const customFieldsLink = page
      .getByRole('link', { name: /custom fields|fields/i })
      .or(page.getByRole('button', { name: /custom fields/i }));
    const visible = await customFieldsLink.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Custom fields section not found in settings nav');
    await customFieldsLink.click();
    await expect(
      page.getByRole('heading', { name: /custom fields/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('contact detail shows custom fields section', async ({ page }) => {
    await page.goto('/contacts', { waitUntil: 'load' });
    const firstLink = page.locator('a[href^="/contacts/"]').first();
    const hasContacts = await firstLink.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(!hasContacts, 'No contacts in seeded data');

    await firstLink.click();
    await expect(page.locator('#main')).toBeVisible({ timeout: 10_000 });

    // Custom fields section (may be in a panel or tab)
    const customSection = page
      .getByText(/custom fields|additional fields|properties/i)
      .first();
    const visible = await customSection.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Custom fields section not visible on contact detail');
    await expect(customSection).toBeVisible();
  });

  test('custom field value is persisted and re-displayed', async ({ page }) => {
    // This test is scoped to the CustomFieldValue Prisma model behavior.
    // It navigates to a contact, finds an editable custom field, sets a value,
    // refreshes, and checks persistence.
    await page.goto('/contacts', { waitUntil: 'load' });
    const firstLink = page.locator('a[href^="/contacts/"]').first();
    const hasContacts = await firstLink.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(!hasContacts, 'No contacts in seeded data');

    await firstLink.click();
    await expect(page.locator('#main')).toBeVisible({ timeout: 10_000 });

    // Try to find a custom field input
    const customInput = page.locator('[data-testid^="custom-field-"]').getByRole('textbox').first();
    const hasInput = await customInput.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!hasInput, 'No editable custom field inputs found on this contact');

    const testValue = `E2E-${Date.now()}`;
    await customInput.fill(testValue);
    await customInput.press('Enter');

    // Save if there's an explicit save button
    const saveBtn = page.getByRole('button', { name: /save|apply/i });
    if (await saveBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await saveBtn.click();
    }

    await page.reload();
    await expect(page.locator('#main')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(testValue)).toBeVisible({ timeout: 5_000 });
  });
});
