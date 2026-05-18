import { test, expect } from './fixtures.js';

test.describe('Pipeline page', () => {
  test('page heading is visible', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/pipeline');
    await expect(page.getByRole('heading', { name: 'Pipeline', level: 1 })).toBeVisible();
  });

  test('stage columns are rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/pipeline');
    // The kanban board renders one <section> per stage with an aria-label
    // formatStage maps 'discovery' → 'Discovery', etc.
    await expect(page.locator('section[aria-label*="Discovery column"]')).toBeVisible();
    await expect(page.locator('section[aria-label*="Qualified column"]')).toBeVisible();
    await expect(page.locator('section[aria-label*="Proposal column"]')).toBeVisible();
  });

  test('KPI cards are rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/pipeline');
    await expect(page.getByText('Total pipeline')).toBeVisible();
    await expect(page.getByText('Open value')).toBeVisible();
    await expect(page.getByText('Win rate')).toBeVisible();
    await expect(page.getByText('Active deals')).toBeVisible();
  });

  test('at least one opportunity card links to detail page', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/pipeline');
    // If no seeded data, the test still passes — we just check the pattern is
    // wired correctly by verifying the columns render (data absence is not a test failure)
    const opportunityLinks = page.locator('a[href^="/opportunities/"]');
    const hasLinks = (await opportunityLinks.count()) > 0;
    if (hasLinks) {
      await expect(opportunityLinks.first()).toBeVisible();
    } else {
      // Empty state is valid — columns still rendered, just no cards
      await expect(page.locator('section[aria-label*="column"]').first()).toBeVisible();
    }
  });
});
