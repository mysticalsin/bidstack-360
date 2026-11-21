/**
 * WCAG 2.4.1 Bypass Blocks. The skip link has to be the first tab stop.
 * It currently sits in the top bar, after every sidebar control, so a
 * keyboard user walks the rail before they can skip it.
 */
import { test, expect } from '@playwright/test';

test('skip link is the first tab stop and moves focus to main', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/dashboard', { waitUntil: 'load' });
  await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 });

  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => {
    const el = document.activeElement;
    return {
      skip: el?.classList.contains('skip-link') ?? false,
      name: (el?.getAttribute('aria-label') || el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    };
  });
  expect(first.skip, `first tab stop was "${first.name}"`).toBe(true);

  // A route announcer used to move focus to <main> 60ms after any keyboard
  // event once translations settled, so the skip link never stayed focused
  // long enough to activate.
  await page.waitForTimeout(250);
  const still = await page.evaluate(() => document.activeElement?.classList.contains('skip-link') ?? false);
  expect(still, 'skip link lost focus before it could be activated').toBe(true);

  await page.keyboard.press('Enter');
  await expect.poll(async () => page.evaluate(() => document.activeElement?.id ?? '')).toBe('main');
});
