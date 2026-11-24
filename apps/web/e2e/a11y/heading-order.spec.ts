/**
 * WCAG 1.3.1 Info and Relationships. Heading rank increases by one.
 * These pages open on an h1 and the next heading is an h3, so a screen
 * reader user who walks by heading skips a level.
 */
import { test, expect, type Page } from '@playwright/test';

const PAGES = [
  { name: 'win-loss', path: '/win-loss' },
  { name: 'analytics', path: '/analytics' },
  { name: 'lead', path: '/leads/00000000-0000-4000-8000-000000000102' },
] as const;

async function headingSkips(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    const skips: string[] = [];
    let prev = 0;
    for (const el of heads) {
      const level = Number(el.tagName.slice(1));
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (prev && level > prev + 1) skips.push(`h${prev} -> h${level} "${text}"`);
      prev = level;
    }
    return skips;
  });
}

for (const item of PAGES) {
  test(`${item.name}: headings do not skip a level`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(item.path, { waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByRole('heading', { level: 1 }).first().waitFor({ state: 'visible', timeout: 15_000 });
    const skips = await headingSkips(page);
    expect(skips, skips.join('; ')).toEqual([]);
  });
}
