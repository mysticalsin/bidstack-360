/**
 * WCAG 2.1.1 Keyboard. At 390px the forecast owner table scrolls sideways.
 * The scroll box is not a tab stop, so a keyboard user cannot reach the
 * columns that sit past the edge.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('forecast owner table can be scrolled from the keyboard at 390', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/forecasts', { waitUntil: 'load' });
  await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 });
  await page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, {
      timeout: 4_000,
    })
    .catch(() => undefined);

  const results = await new AxeBuilder({ page })
    .withRules(['scrollable-region-focusable'])
    .exclude('iframe')
    .analyze();

  const summary = results.violations
    .flatMap((v) => v.nodes.slice(0, 3).map((n) => JSON.stringify(n.target)))
    .join('\n');
  expect(summary, summary).toBe('');
});
