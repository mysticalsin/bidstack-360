/**
 * One-way axe ratchet for WCAG 2.2 AA (critical and serious).
 *
 * A violation that is not in axe-ratchet.baseline.json fails CI. A baseline
 * row that no longer reproduces does not fail — delete it when the fix
 * merges so a regression is caught the next time.
 *
 * The baseline is current main, including bugs fixed only in open drafts.
 * Those rows name the draft in the write-up (docs/sweeps/sweep-17.md).
 *
 * AXE_RATCHET_RECORD=1 rewrites the baseline from this run. Do not set it
 * in CI.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASELINE = new URL('./axe-ratchet.baseline.json', import.meta.url);

const ROUTES = [
  '/dashboard',
  '/accounts',
  '/opportunities',
  '/contacts',
  '/settings',
  '/forecasts',
  '/references',
  '/analytics',
  '/win-loss',
  '/pipeline',
  '/tasks',
  '/proposals',
  '/contacts/8a7b76f2-1b4c-4746-8fb9-b4f10666d806',
  '/leads/00000000-0000-4000-8000-000000000102',
  '/opportunities/46154b62-b971-4357-886c-5413ad12137f',
] as const;

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 800 },
  { name: '390', width: 390, height: 844 },
] as const;

const THEMES = ['light', 'dark'] as const;

test('no new critical or serious axe violations', async ({ page }) => {
  test.setTimeout(360_000);
  const seen = new Set<string>();

  for (const theme of THEMES) {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(ROUTES[0], { waitUntil: 'load' });
      await page.evaluate((t) => {
        localStorage.setItem('bidstack-theme', t);
      }, theme);
      await page.reload({ waitUntil: 'load' });

      for (const path of ROUTES) {
        await page.goto(path, { waitUntil: 'load' });
        await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
        await page
          .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, {
            timeout: 4_000,
          })
          .catch(() => undefined);

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .exclude('iframe')
          .analyze();

        for (const violation of results.violations) {
          if (violation.impact !== 'critical' && violation.impact !== 'serious') continue;
          seen.add(`${vp.name}|${theme}|${path}|${violation.id}`);
        }
      }
    }
  }

  const found = [...seen].sort();
  if (process.env.AXE_RATCHET_RECORD === '1') {
    writeFileSync(
      BASELINE,
      JSON.stringify(
        {
          note: 'One-way allowlist. A critical/serious violation not listed here fails. Delete a row when its fix is on main.',
          allow: found,
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as { allow: string[] };
  const allowed = new Set(baseline.allow);
  const unexpected = found.filter((key) => !allowed.has(key));
  expect(unexpected, unexpected.join('\n')).toEqual([]);
});
