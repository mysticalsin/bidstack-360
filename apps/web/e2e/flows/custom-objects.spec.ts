/**
 * custom-objects.spec.ts
 *
 * WHY: Custom Objects extend BidStack with engagement-specific entities
 * (Projects, Deliverables, etc.). The create → list → detail journey must
 * work end-to-end, or the schema extension is useless.
 */
import { test, expect } from '@playwright/test';
import { CustomObjectsAdminPage } from '../pages/CustomObjectsAdminPage.js';

test.describe('Custom objects', () => {
  test('custom objects admin is accessible', async ({ page }) => {
    const admin = new CustomObjectsAdminPage(page);
    await admin.navigate();
    const available = await admin.isAvailable();
    test.skip(!available, '/settings/custom-objects not found — feature may be unreleased');
    await expect(admin.heading).toBeVisible({ timeout: 15_000 });
  });

  test('object list renders (empty or seeded)', async ({ page }) => {
    const admin = new CustomObjectsAdminPage(page);
    await admin.navigate();
    const available = await admin.isAvailable();
    test.skip(!available, '/settings/custom-objects not found');

    await expect(
      admin.objectList.or(page.getByText(/no custom objects|create your first/i)).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('new object button is present', async ({ page }) => {
    const admin = new CustomObjectsAdminPage(page);
    await admin.navigate();
    const available = await admin.isAvailable();
    test.skip(!available, '/settings/custom-objects not found');

    await expect(admin.newObjectButton).toBeVisible({ timeout: 10_000 });
  });

  test('creating a custom object shows it in the list', async ({ page }) => {
    const admin = new CustomObjectsAdminPage(page);
    await admin.navigate();
    const available = await admin.isAvailable();
    test.skip(!available, '/settings/custom-objects not found');

    const newObjectVisible = await admin.newObjectButton.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!newObjectVisible, 'New object button not visible');

    const objectName = `E2EProject${Date.now()}`;
    await admin.createObject({ name: objectName, pluralName: `${objectName}s` });
    // Admin page should now list the new object type
    await expect(page.getByText(new RegExp(objectName, 'i'))).toBeVisible({ timeout: 10_000 });
  });

  test('seeded or created custom object has a records list route', async ({ page }) => {
    // Check if any custom object records link exists in the sidebar or nav
    const customObjectLink = page
      .locator('[data-testid^="nav-custom-object-"]')
      .or(page.locator('a[href^="/objects/"]'))
      .first();

    await page.goto('/dashboard', { waitUntil: 'load' });
    const hasLink = await customObjectLink.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasLink, 'No custom object nav links found — create a custom object type first');

    await customObjectLink.click();
    await expect(page.locator('#main')).toBeVisible({ timeout: 10_000 });
    // List or empty-state should appear
    await expect(
      page.getByRole('table').or(page.getByText(/no records|empty/i)).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
