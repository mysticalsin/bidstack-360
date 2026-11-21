/**
 * WHY: Add widget opens a dialog the phone cannot use. The panel is
 * `position: relative`, so it starts below the viewport, the overlay covers
 * it, and Radix locks page scroll. The title field is not a hit target on a
 * 390×844 phone or an 844×390 landscape phone.
 */
import { expect, test, type Page } from '@playwright/test';

test.use({ hasTouch: true, isMobile: true });

async function openAddWidget(page: Page): Promise<void> {
  await page.goto('/analytics', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Add widget' }).evaluate((el) => {
    (el as HTMLButtonElement).click();
  });
}

async function titleFieldIsOnScreen(page: Page, viewportHeight: number): Promise<void> {
  const input = page.getByPlaceholder('Widget title');
  await expect(input).toBeVisible();
  const box = await input.boundingBox();
  expect(box, 'title field has a box').not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewportHeight);
  const hit = await input.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return top === el || el.contains(top);
  });
  expect(hit, 'the title field receives the tap, not the overlay').toBe(true);
}

test('add-widget title is on screen at 390×844', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAddWidget(page);
  await titleFieldIsOnScreen(page, 844);
});

test('add-widget title is on screen in landscape', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openAddWidget(page);
  await titleFieldIsOnScreen(page, 390);
});
