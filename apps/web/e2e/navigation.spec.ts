import { test, expect } from './fixtures.js';

test.describe('Navigation accessibility', () => {
  test('desktop sidebar keeps accessible names when collapsed', async ({ page, gotoAndWait }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoAndWait('/dashboard');

    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    const primaryNav = page.getByRole('navigation', { name: 'Primary navigation' });

    await expect(primaryNav.getByRole('link', { name: 'Dashboard' })).toBeVisible();

    // Hover over the Sales button to reveal the flyout menu
    await primaryNav.getByRole('button', { name: 'Sales' }).hover();
    await expect(primaryNav.getByRole('link', { name: 'Quotations & Orders' })).toBeVisible();

    // Hover over the Pipeline button to reveal the flyout menu
    await primaryNav.getByRole('button', { name: 'Pipeline' }).hover();
    await expect(primaryNav.getByRole('link', { name: 'Opportunities' })).toBeVisible();
  });

  test('mobile drawer exposes primary navigation and closes with Escape', async ({
    page,
    gotoAndWait,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await gotoAndWait('/dashboard');

    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog', { name: 'Primary navigation' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Settings' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });

  test('hamburger remains available at tablet breakpoint', async ({ page, gotoAndWait }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await gotoAndWait('/dashboard');

    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  });

  test('desktop sidebar toggle remains anchored while scrolling long pages', async ({
    page,
    gotoAndWait,
  }) => {
    await page.setViewportSize({ width: 1440, height: 720 });
    await gotoAndWait('/agent-studio');
    await page.addStyleTag({ content: '#main { min-height: 2200px !important; }' });

    const toggle = page.getByRole('button', { name: 'Collapse sidebar' });
    const before = await toggle.boundingBox();
    expect(before).not.toBeNull();

    await page.evaluate(() => window.scrollTo(0, 900));
    await expect(toggle).toBeVisible();
    const after = await toggle.boundingBox();

    expect(after).not.toBeNull();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
  });
});
