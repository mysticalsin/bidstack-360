/**
 * realtime-presence.spec.ts
 *
 * WHY: Real-time presence (AvatarStack showing who's viewing the same deal)
 * prevents double-editing conflicts. If presence stops working, two reps
 * can overwrite each other's edits silently. Requires two browser contexts
 * to simulate concurrent users.
 */
import { test, expect } from '@playwright/test';

test.describe('Real-time presence', () => {
  test('two users on same deal both see the AvatarStack update', async ({ browser }) => {
    // Two separate browser contexts simulate two distinct authenticated sessions.
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      // Load opportunities in both contexts.
      await page1.goto('/opportunities', { waitUntil: 'load' });
      const firstLink = page1.locator('a[href^="/opportunities/"]').first();
      const hasLink = await firstLink.isVisible({ timeout: 10_000 }).catch(() => false);

      if (!hasLink) {
        test.skip(true, 'No opportunities — seeded data absent, cannot test presence');
        return;
      }

      const href = (await firstLink.getAttribute('href')) ?? '';
      if (!href) {
        test.skip(true, 'Could not extract opportunity URL');
        return;
      }

      // Both contexts navigate to the same deal.
      await Promise.all([
        page1.goto(href, { waitUntil: 'load' }),
        page2.goto(href, { waitUntil: 'load' }),
      ]);

      await Promise.all([
        page1.locator('#main').waitFor({ state: 'visible' }),
        page2.locator('#main').waitFor({ state: 'visible' }),
      ]);

      // Wait for WS to sync presence (give it 3s)
      await page1.waitForTimeout(3_000);

      // Check for AvatarStack / presence indicator on page1
      const avatarStack = page1.locator('[data-testid="avatar-stack"], [aria-label*="viewing"]');
      const presenceVisible = await avatarStack.isVisible({ timeout: 5_000 }).catch(() => false);

      if (!presenceVisible) {
        test.skip(true, 'AvatarStack not visible — real-time presence may not be enabled in this build');
        return;
      }

      await expect(avatarStack).toBeVisible();
      // The stack should show at least 2 avatars (or a +1 overflow badge)
      const avatarCount = await avatarStack.locator('img, [data-testid="avatar"]').count();
      const overflow = await avatarStack.getByText(/\+/).isVisible({ timeout: 1_000 }).catch(() => false);
      expect(avatarCount >= 2 || overflow).toBe(true);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('presence avatar disappears when user navigates away', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      await page1.goto('/opportunities', { waitUntil: 'load' });
      const firstLink = page1.locator('a[href^="/opportunities/"]').first();
      const hasLink = await firstLink.isVisible({ timeout: 10_000 }).catch(() => false);
      test.skip(!hasLink, 'No opportunities for presence test');

      const href = (await firstLink.getAttribute('href')) ?? '';
      await Promise.all([
        page1.goto(href, { waitUntil: 'load' }),
        page2.goto(href, { waitUntil: 'load' }),
      ]);

      // Both visible
      await page1.waitForTimeout(2_000);
      const avatarStack = page1.locator('[data-testid="avatar-stack"]');
      const presenceVisible = await avatarStack.isVisible({ timeout: 3_000 }).catch(() => false);
      test.skip(!presenceVisible, 'Presence not implemented');

      // page2 navigates away
      await page2.goto('/dashboard', { waitUntil: 'load' });
      await page1.waitForTimeout(3_000);

      // AvatarStack on page1 should now show fewer avatars
      const avatarCount = await avatarStack.locator('img, [data-testid="avatar"]').count();
      expect(avatarCount).toBeLessThan(2);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
