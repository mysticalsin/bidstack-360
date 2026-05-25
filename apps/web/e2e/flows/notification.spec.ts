/**
 * notification.spec.ts
 *
 * WHY: Notifications are how the app surfaces task assignments and mentions
 * to users. A silent failure here means users miss critical updates. This
 * spec verifies the bell renders, the tray opens, and notifications can be
 * marked read.
 */
import { test, expect } from '@playwright/test';
import { NotificationsPage } from '../pages/NotificationsPage.js';

test.describe('Notifications', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible' });
  });

  test('notification bell is visible in app shell', async ({ page }) => {
    const notifs = new NotificationsPage(page);
    await expect(notifs.bell).toBeVisible({ timeout: 10_000 });
  });

  test('clicking bell opens notification tray', async ({ page }) => {
    const notifs = new NotificationsPage(page);
    await expect(notifs.bell).toBeVisible({ timeout: 10_000 });
    await notifs.openTray();
    // Tray or empty-state must appear
    await expect(
      notifs.tray.or(notifs.emptyState).or(page.getByText(/no notifications/i)).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('tray closes on outside click', async ({ page }) => {
    const notifs = new NotificationsPage(page);
    await expect(notifs.bell).toBeVisible({ timeout: 10_000 });
    await notifs.openTray();

    // Click the main content area to dismiss
    await page.mouse.click(50, 50);
    await expect(notifs.tray).not.toBeVisible({ timeout: 5_000 });
  });

  test('mark all read clears badge (if notifications exist)', async ({ page }) => {
    const notifs = new NotificationsPage(page);
    await expect(notifs.bell).toBeVisible({ timeout: 10_000 });
    await notifs.openTray();

    const hasMarkAll = await notifs.markAllReadButton
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    test.skip(!hasMarkAll, 'No "mark all read" button — likely no unread notifications');

    await notifs.markAllRead();
    // Badge should disappear or show 0
    const badgeVisible = await notifs.badge.isVisible({ timeout: 2_000 }).catch(() => false);
    if (badgeVisible) {
      const text = await notifs.badge.innerText();
      expect(Number(text) || 0).toBe(0);
    }
  });
});
