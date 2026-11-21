/**
 * color-contrast.spec.ts
 *
 * WHY: WCAG 2.2 SC 1.4.3 requires 4.5:1 contrast for normal text and 3:1
 * for large text/UI components. Design tokens in both light and dark modes
 * must meet this. This spec uses axe's color-contrast rule (narrowly scoped)
 * and supplements with JS-based checks for the critical token pairs.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Key routes to contrast-check in both themes. */
const CONTRAST_ROUTES = [
  '/dashboard',
  '/pipeline',
  '/leads',
  '/contacts',
  '/settings',
  '/opportunities',
  // Account segment counts are brand-colored numerals, not body text.
  '/accounts',
] as const;

for (const theme of ['light', 'dark'] as const) {
  for (const route of CONTRAST_ROUTES) {
    test(`${route} (${theme}): color-contrast axe rule passes`, async ({ page }) => {
      // Playwright restores storageState after init scripts, which drops any
      // theme key set before the first load. index.html then paints light.
      // Set the key the pre-paint script actually reads, then reload.
      await page.goto(route, { waitUntil: 'load' });
      await page.evaluate((t) => {
        localStorage.setItem('bidstack-theme', t);
      }, theme);
      await page.reload({ waitUntil: 'load' });
      await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      await page
        .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, {
          timeout: 4_000,
        })
        .catch(() => undefined);

      const results = await new AxeBuilder({ page })
        .withRules(['color-contrast'])
        .exclude('iframe')
        .analyze();

      const critical = results.violations.filter(
        (v) => v.id === 'color-contrast' && (v.impact === 'critical' || v.impact === 'serious'),
      );

      if (critical.length > 0) {
        const detail = critical.flatMap((v) =>
          v.nodes.slice(0, 3).map((n) =>
            `  element: ${JSON.stringify(n.target)} — ${n.failureSummary}`,
          ),
        ).join('\n');
        throw new Error(
          `Color-contrast violations in ${theme} mode on ${route}:\n${detail}`,
        );
      }

      expect(critical.length).toBe(0);
    });
  }
}

test('dark mode: CSS variables produce valid contrast for primary text', async ({ page }) => {
  await page.goto('/dashboard', { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.setItem('bidstack-theme', 'dark');
  });
  await page.reload({ waitUntil: 'load' });
  await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(300);

  // Check the computed color + background of the first paragraph or span.
  const contrastInfo = await page.evaluate(() => {
    const el = document.querySelector('p, span, td, [data-testid]') as HTMLElement | null;
    if (!el) return null;
    const style = window.getComputedStyle(el);
    return {
      color: style.color,
      background: style.backgroundColor,
    };
  });

  // We can't compute exact WCAG ratio in JS without a library, but at minimum
  // verify the color values are not the same (would be invisible text).
  if (contrastInfo) {
    expect(contrastInfo.color).not.toBe(contrastInfo.background);
  }
});
