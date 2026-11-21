/**
 * WHY: At 390px the top bar spends its width on icon buttons and leaves the
 * current page name about 45px. "Opportunities" is clipped mid-word, so the
 * phone bar does not say where you are.
 */
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('the phone top bar shows the full page name', async ({ page }) => {
  await page.goto('/opportunities', { waitUntil: 'domcontentloaded' });
  const here = page.locator('header.topbar .here');
  await expect(here).toHaveText('Opportunities');
  const clipped = await here.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(clipped).toBeLessThanOrEqual(1);
});
