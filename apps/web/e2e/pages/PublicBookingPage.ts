/**
 * PublicBookingPage POM
 *
 * Covers /book/:slug — the public-facing calendar booking page.
 * No auth required. Visitors pick a slot and submit contact details.
 * Uses data-testid selectors where available; falls back to ARIA roles.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class PublicBookingPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly calendarGrid: Locator;
  readonly dateButtons: Locator;
  readonly timeSlots: Locator;
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly confirmButton: Locator;
  readonly successMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { level: 1 });
    this.calendarGrid = page.getByRole('grid').or(page.locator('[data-testid="booking-calendar"]'));
    this.dateButtons = page.locator('[data-testid="booking-calendar"] button');
    this.timeSlots = page
      .getByRole('button', { name: /available slot/i })
      .or(page.locator('[data-testid="time-slot"]'));
    this.nameInput = page.getByRole('textbox', { name: /name/i });
    this.emailInput = page.getByRole('textbox', { name: /email/i });
    this.confirmButton = page.getByRole('button', { name: /confirm|book|schedule/i });
    this.successMessage = page.getByRole('heading', { name: /booking confirmed/i });
  }

  async navigate(slug: string): Promise<void> {
    await this.page.goto(`/book/${slug}`, { waitUntil: 'load' });
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
  }

  async isAvailable(): Promise<boolean> {
    const terminalState = this.calendarGrid
      .or(this.timeSlots.first())
      .or(this.page.getByText(/booking page not found|invalid|no longer accepting/i))
      .first();
    await terminalState.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    return !(await this.page
      .getByText(/booking page not found|invalid|no longer accepting/i)
      .isVisible()
      .catch(() => false));
  }

  async pickFirstAvailableSlot(): Promise<boolean> {
    const dayCount = await this.dateButtons.count();
    const attempts = Math.max(dayCount, 1);

    for (let i = 0; i < attempts; i += 1) {
      if (i > 0) {
        const availabilityResponse = this.page
          .waitForResponse((res) => res.url().includes('/availability') && res.status() === 200, {
            timeout: 10_000,
          })
          .catch(() => null);
        await this.dateButtons.nth(i).click();
        await availabilityResponse;
      }

      const firstSlot = this.timeSlots.first();
      const hasSlot = await firstSlot
        .waitFor({ state: 'visible', timeout: 3_000 })
        .then(() => true)
        .catch(() => false);
      if (hasSlot) {
        await firstSlot.click();
        return true;
      }
    }

    return false;
  }

  async fillContactDetails(opts: { name: string; email: string }): Promise<void> {
    await this.nameInput.fill(opts.name);
    await this.emailInput.fill(opts.email);
  }

  async submit(): Promise<void> {
    await this.confirmButton.click();
  }

  async assertBookingConfirmed(): Promise<void> {
    await expect(this.successMessage).toBeVisible({ timeout: 15_000 });
  }
}
