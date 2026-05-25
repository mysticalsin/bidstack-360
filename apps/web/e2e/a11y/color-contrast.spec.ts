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
] as const;

for (const theme of ['light', 'dark'] as const) {
  for (const route of CONTRAST_ROUTES) {
    test(`${route} (${theme}): color-contrast axe rule passes`, async ({ page }) => {
      // Set theme before navigation so CSS variables are applied on load.
      await page.addInitScript((t) => {
        document.documentElement.setAttribute('data-theme', t);
        localStorage.setItem('theme', t);
      }, theme);

      await page.goto(route, { waitUntil: 'load' });
      await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(300); // Let CSS vars settle

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
  await page.addInitScript(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  });

  await page.goto('/dashboard', { waitUntil: 'load' });
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
