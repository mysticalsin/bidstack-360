import { test, expect } from './fixtures.js';

// Experience layer: the Sound preference UI + that page transitions don't break
// routing. data-sound on <html> is the source of truth the sound engine reads.
test.describe('Experience layer', () => {
  test('Appearance settings expose Sound controls and persist the toggle', async ({
    page,
    gotoAndWait,
  }) => {
    await gotoAndWait('/settings?tab=appearance');

    // Sound card + its controls are present.
    await expect(page.getByText('Sound effects', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Sound volume')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Click' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Success' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Error' })).toBeVisible();

    // Default is on; toggling the checkbox (via its label) flips data-sound and
    // the choice survives a reload (persisted + user-scoped).
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-sound', 'on');

    await page.getByText('Sound effects', { exact: true }).click();
    await expect(html).toHaveAttribute('data-sound', 'off');

    await page.reload();
    await page.getByRole('main').waitFor({ state: 'visible' });
    await expect(page.locator('html')).toHaveAttribute('data-sound', 'off');

    // Restore for other tests/state hygiene.
    await page.getByText('Sound effects', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-sound', 'on');
  });

  test('page transitions do not break navigation between routes', async ({
    page,
    gotoAndWait,
  }) => {
    await gotoAndWait('/dashboard');
    await expect(page.getByRole('main')).toBeVisible();

    await gotoAndWait('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

    await gotoAndWait('/accounts');
    await expect(page.getByRole('main')).toBeVisible();
  });
});
