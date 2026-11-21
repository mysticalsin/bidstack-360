/**
 * WHY: On a 390px phone the analytics header keeps Reports, New report, and
 * Add widget on one row with the title. The row runs past the screen and the
 * shell clips it, so Add widget cannot be tapped.
 */
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('Add widget is inside the 390px phone', async ({ page }) => {
  await page.goto('/analytics', { waitUntil: 'domcontentloaded' });
  const button = page.getByRole('button', { name: 'Add widget' });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box, 'Add widget has a box').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});
