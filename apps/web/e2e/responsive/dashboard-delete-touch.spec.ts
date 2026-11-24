/**
 * WHY: Deleting a dashboard was `hidden` until hover. A phone has no hover,
 * so the control never entered the accessibility tree and could not be tapped.
 */
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('delete dashboard is tappable without hover', async ({ page }) => {
  await page.goto('/dashboards', { waitUntil: 'domcontentloaded' });
  const button = page.getByRole('button', { name: /Delete dashboard/i });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box, 'delete button has a box').not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});
