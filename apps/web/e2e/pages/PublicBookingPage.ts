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
  readonly timeSlots: Locator;
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly confirmButton: Locator;
  readonly successMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { level: 1 });
    this.calendarGrid = page.getByRole('grid').or(page.locator('[data-testid="booking-calendar"]'));
    this.timeSlots = page.locator('[data-testid="time-slot"], button[aria-label*="slot"], button[aria-label*="available"]');
    this.nameInput = page.getByRole('textbox', { name: /name/i });
    this.emailInput = page.getByRole('textbox', { name: /email/i });
    this.confirmButton = page.getByRole('button', { name: /confirm|book|schedule/i });
    this.successMessage = page.getByText(/booking confirmed|you're booked|thank you/i);
  }

  async navigate(slug: string): Promise<void> {
    await this.page.goto(`/book/${slug}`, { waitUntil: 'load' });
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
  }

  async isAvailable(): Promise<boolean> {
    return this.heading.isVisible({ timeout: 5_000 }).catch(() => false);
  }

  async pickFirstAvailableSlot(): Promise<boolean> {
    const count = await this.timeSlots.count();
    if (count === 0) return false;
    await this.timeSlots.first().click();
    return true;
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
