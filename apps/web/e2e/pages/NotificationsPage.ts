/**
 * NotificationsPage POM
 *
 * Covers the notification bell + notification tray.
 * Notifications are driven by real-time events (task assigned, mention, etc.)
 * In E2E, these events are triggered via mock server fixtures.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class NotificationsPage {
  readonly page: Page;
  readonly bell: Locator;
  readonly badge: Locator;
  readonly tray: Locator;
  readonly notificationItems: Locator;
  readonly markAllReadButton: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    this.page = page;
    this.bell = page.getByRole('button', { name: /notifications/i })
      .or(page.locator('[data-testid="notification-bell"]'))
      .first();
    this.badge = page.locator('[data-testid="notification-badge"]')
      .or(page.locator('.notification-count'))
      .first();
    this.tray = page.locator('[data-testid="notification-tray"], [role="dialog"][aria-label*="notification"]');
    this.notificationItems = this.tray.locator('[data-testid="notification-item"], li');
    this.markAllReadButton = this.tray.getByRole('button', { name: /mark all read|clear all/i });
    this.emptyState = this.tray.getByText(/no notifications|all caught up/i);
  }

  async openTray(): Promise<void> {
    await this.bell.click();
    await expect(this.tray.first()).toBeVisible({ timeout: 5_000 });
  }

  async assertBadgeCount(expectedMin: number): Promise<void> {
    const text = await this.badge.innerText().catch(() => '0');
    const count = parseInt(text, 10) || 0;
    if (count < expectedMin) {
      throw new Error(`Expected at least ${expectedMin} notifications, found ${count}`);
    }
  }

  async markAllRead(): Promise<void> {
    await this.markAllReadButton.click();
    await expect(this.emptyState.or(this.page.getByText(/no new notifications/i)).first()).toBeVisible({
      timeout: 5_000,
    });
  }

  async clickFirstNotification(): Promise<void> {
    await this.notificationItems.first().click();
  }
}
