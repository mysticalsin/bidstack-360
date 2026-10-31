import { test, expect } from './fixtures.js';

// v13 surfaces: dashboard hero + watchdog pulse, the tabbed Performance card
// (Revenue / Win rate / Top accounts), chart table toggles, and the account
// header's Generate brief CommandButton (Shift+B) with its generating state.
const apiUrl = process.env.E2E_API_URL ?? 'http://localhost:4010';

test.describe('Dashboard visuals', () => {
  test('hero shows the open-pipeline figures and a chart', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/dashboard');
    const hero = page.getByTestId('dashboard-hero');
    await expect(hero).toBeVisible({ timeout: 15_000 });
    await expect(hero.getByRole('heading', { name: 'Open pipeline' })).toBeVisible();
    await expect(hero.getByText('Won this year')).toBeVisible();
    // Charts are lazy-loaded; the reserve box is replaced by an SVG.
    await expect(hero.locator('svg').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Performance card switches between Revenue, Win rate and Top accounts', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/dashboard');
    const perf = page.getByTestId('dashboard-performance');
    await expect(perf.getByRole('heading', { name: 'Performance', level: 2 })).toBeVisible({ timeout: 15_000 });
    const tabs = perf.getByRole('tablist', { name: 'Performance views' });
    await expect(tabs.getByRole('tab')).toHaveCount(3);
    await expect(tabs.getByRole('tab', { name: 'Revenue' })).toHaveAttribute('aria-selected', 'true');

    await tabs.getByRole('tab', { name: 'Win rate' }).click();
    await expect(tabs.getByRole('tab', { name: 'Win rate' })).toHaveAttribute('aria-selected', 'true');
    await expect(perf.getByRole('heading', { level: 3 }).first()).toBeVisible();

    await tabs.getByRole('tab', { name: 'Top accounts' }).click();
    await expect(perf.getByRole('heading', { name: /Top accounts/, level: 3 })).toBeVisible();
  });

  test('chart cards expose a data-table toggle for screen-reader and keyboard users', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/dashboard');
    const hero = page.getByTestId('dashboard-hero');
    await expect(hero).toBeVisible({ timeout: 15_000 });
    const toggle = hero.getByRole('button', { name: /table/i }).first();
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(hero.getByRole('table')).toBeVisible();
    await expect(hero.getByRole('columnheader', { name: 'Won to date' })).toBeVisible();
  });

  test('reduced motion still renders the hero figures', async ({ page, gotoAndWait }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoAndWait('/dashboard');
    const hero = page.getByTestId('dashboard-hero');
    await expect(hero).toBeVisible({ timeout: 15_000 });
    await expect(hero.locator('.dash-hero-num').first()).not.toBeEmpty();
  });
});

test.describe('Account header brief', () => {
  test('Generate brief is a Shift+B command button and shows a generating state', async ({ page, request, gotoAndWait }) => {
    const [oppsRes, coRes] = await Promise.all([
      request.get(`${apiUrl}/api/v1/opportunities?limit=50`),
      request.get(`${apiUrl}/api/v1/companies?limit=200`),
    ]);
    expect(oppsRes.ok()).toBeTruthy();
    expect(coRes.ok()).toBeTruthy();
    const customers = new Set(((await oppsRes.json()) as { items: Array<{ customer: string }> }).items.map((o) => o.customer.toLowerCase()));
    const company = ((await coRes.json()) as { items: Array<{ id: string; name: string }> }).items.find((c) => customers.has(c.name.toLowerCase()));
    test.skip(!company, 'Seed has no account with a linked opportunity');

    // Hold the brief request so the generating panel stays on screen.
    await page.route('**/brief', () => undefined);
    await gotoAndWait(`/accounts/${company!.id}`);
    const btn = page.getByRole('button', { name: /Generate brief/ });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await expect(btn).toHaveAttribute('aria-keyshortcuts', 'Shift+B');

    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Shift+B');
    const generating = page.getByTestId('brief-generating');
    await expect(generating).toBeVisible({ timeout: 10_000 });
    await expect(generating.getByText('Reading the account')).toBeVisible();
  });
});
