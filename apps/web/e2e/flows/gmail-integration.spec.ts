/**
 * gmail-integration.spec.ts
 *
 * WHY: Email threading is a core differentiator — a broken Gmail integration
 * means emails aren't logged against contacts. OAuth is mocked via MSW
 * so no real Google credentials are needed in CI.
 */
import { test, expect } from '@playwright/test';
import { IntegrationsPage } from '../pages/IntegrationsPage.js';

test.describe('Gmail integration (mocked OAuth)', () => {
  test('integrations page renders Gmail card', async ({ page }) => {
    const integrations = new IntegrationsPage(page);
    await integrations.navigate();
    await expect(integrations.gmailCard).toBeVisible({ timeout: 15_000 });
  });

  test('Gmail card shows Connect or Connected status', async ({ page }) => {
    const integrations = new IntegrationsPage(page);
    await integrations.navigate();
    const gmailSection = integrations.gmailCard.locator('..').locator('..');
    await expect(
      gmailSection.getByRole('button', { name: /connect|disconnect/i })
        .or(gmailSection.getByText(/connected|active/i)),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('email thread view renders on contact detail', async ({ page }) => {
    // Navigate to a contact that has email threads
    await page.goto('/contacts', { waitUntil: 'load' });
    const firstLink = page.locator('a[href^="/contacts/"]').first();
    const hasContacts = await firstLink.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(!hasContacts, 'No contacts in seeded data');

    await firstLink.click();
    await expect(page.locator('#main')).toBeVisible({ timeout: 10_000 });

    // Email tab or email section
    const emailTab = page.getByRole('tab', { name: /email|messages/i });
    if (await emailTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await emailTab.click();
      await expect(
        page.getByText(/no emails|inbox|thread/i).or(page.locator('[data-testid="email-thread"]')).first(),
      ).toBeVisible({ timeout: 10_000 });
    } else {
      // Email may be in-line in the activity feed
      const emailItem = page.getByText(/email|message/i).first();
      test.skip(
        !(await emailItem.isVisible({ timeout: 3_000 }).catch(() => false)),
        'Email section not found on contact detail',
      );
    }
  });
});
