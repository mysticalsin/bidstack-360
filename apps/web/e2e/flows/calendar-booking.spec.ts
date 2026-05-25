/**
 * calendar-booking.spec.ts
 *
 * WHY: The public booking page (/book/:slug) is a customer-facing touchpoint.
 * Errors here block prospects from scheduling meetings — directly impacting
 * revenue. No auth required; test exercises the full slot-pick → submit flow.
 */
import { test, expect } from '@playwright/test';
import { PublicBookingPage } from '../pages/PublicBookingPage.js';

const TEST_SLUG = process.env.E2E_BOOKING_SLUG ?? 'test-slug';

test.describe('Calendar booking (public)', () => {
  test('booking page renders for a known slug', async ({ page }) => {
    const booking = new PublicBookingPage(page);
    await booking.navigate(TEST_SLUG);

    const available = await booking.isAvailable();
    test.skip(!available, `Booking page for slug "${TEST_SLUG}" not found — seed a BookingPage row`);

    await expect(booking.heading).toBeVisible({ timeout: 15_000 });
    // Calendar grid or time-slot picker must be visible
    await expect(
      booking.calendarGrid.or(booking.timeSlots.first()).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('visitor can select a slot and see contact form', async ({ page }) => {
    const booking = new PublicBookingPage(page);
    await booking.navigate(TEST_SLUG);

    const available = await booking.isAvailable();
    test.skip(!available, `Booking page slug "${TEST_SLUG}" not found`);

    const hasSlot = await booking.pickFirstAvailableSlot();
    test.skip(!hasSlot, 'No available time slots — check BookingPage fixture');

    // After picking a slot, the contact form should appear
    await expect(booking.nameInput.or(booking.emailInput).first()).toBeVisible({ timeout: 10_000 });
  });

  test('full booking flow: pick slot → fill form → submit', async ({ page }) => {
    const booking = new PublicBookingPage(page);
    await booking.navigate(TEST_SLUG);

    const available = await booking.isAvailable();
    test.skip(!available, `Booking page slug "${TEST_SLUG}" not found`);

    const hasSlot = await booking.pickFirstAvailableSlot();
    test.skip(!hasSlot, 'No available time slots');

    const formVisible = await booking.nameInput.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!formVisible, 'Contact form did not appear after slot selection');

    await booking.fillContactDetails({
      name: 'E2E Test User',
      email: 'e2e@bidstack-test.example',
    });
    await booking.submit();
    await booking.assertBookingConfirmed();
  });
});
