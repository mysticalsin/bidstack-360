/**
 * calendar-booking.spec.ts
 *
 * WHY: The public booking page (/book/:slug) is a customer-facing touchpoint.
 * Errors here block prospects from scheduling meetings and directly impact
 * revenue. No auth required; test exercises the full slot-pick to submit flow.
 */
import { test, expect } from '@playwright/test';
import { seededValue } from '../fixtures/env.js';
import { PublicBookingPage } from '../pages/PublicBookingPage.js';

const TEST_SLUG = seededValue('E2E_BOOKING_SLUG', 'test-slug');

test.describe('Calendar booking (public)', () => {
  test('booking page renders for a known slug', async ({ page }) => {
    const booking = new PublicBookingPage(page);
    await booking.navigate(TEST_SLUG);

    const available = await booking.isAvailable();
    expect(available, `Booking page for slug "${TEST_SLUG}" must exist in seeded E2E data`).toBe(
      true,
    );

    await expect(booking.heading).toBeVisible({ timeout: 15_000 });
    await expect(booking.calendarGrid.or(booking.timeSlots.first()).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('visitor can select a slot and see contact form', async ({ page }) => {
    const booking = new PublicBookingPage(page);
    await booking.navigate(TEST_SLUG);

    const available = await booking.isAvailable();
    expect(available, `Booking page slug "${TEST_SLUG}" must exist`).toBe(true);

    const hasSlot = await booking.pickFirstAvailableSlot();
    expect(hasSlot, 'Seeded booking page must expose at least one available slot').toBe(true);

    await expect(booking.nameInput.or(booking.emailInput).first()).toBeVisible({ timeout: 10_000 });
  });

  test('full booking flow: pick slot, fill form, submit', async ({ page }) => {
    const booking = new PublicBookingPage(page);
    await booking.navigate(TEST_SLUG);

    const available = await booking.isAvailable();
    expect(available, `Booking page slug "${TEST_SLUG}" must exist`).toBe(true);

    const hasSlot = await booking.pickFirstAvailableSlot();
    expect(hasSlot, 'Seeded booking page must expose at least one available slot').toBe(true);

    const formVisible = await booking.nameInput.isVisible({ timeout: 5_000 }).catch(() => false);
    expect(formVisible, 'Contact form must appear after slot selection').toBe(true);

    await booking.fillContactDetails({
      name: 'E2E Test User',
      email: 'e2e@bidstack-test.example',
    });
    await booking.submit();
    await booking.assertBookingConfirmed();
  });
});
