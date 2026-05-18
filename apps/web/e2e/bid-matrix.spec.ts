import { test, expect } from './fixtures.js';

test.describe('Bid/No-Bid Decision Matrix page', () => {
  test('page heading is visible', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/bid-matrix');
    await expect(
      page.getByRole('heading', { name: 'Bid/No-Bid Decision Matrix', level: 1 }),
    ).toBeVisible();
  });

  test('category sections are rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/bid-matrix');
    await expect(page.getByText('Strategic Alignment')).toBeVisible();
    await expect(page.getByText('Technical Readiness')).toBeVisible();
    await expect(page.getByText('Commercial Viability')).toBeVisible();
    await expect(page.getByText('Risk Assessment')).toBeVisible();
  });

  test('overall bid score ring is present', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/bid-matrix');
    // Score ring has an aria-label like "Overall bid score: 42%"
    await expect(page.locator('[aria-label^="Overall bid score:"]')).toBeVisible();
  });

  test('decision notes textarea is present', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/bid-matrix');
    await expect(page.getByRole('textbox', { name: 'Bid decision notes' })).toBeVisible();
  });

  test('score buttons are interactive', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/bid-matrix');
    // Score buttons have aria-pressed attribute and aria-labels like
    // "${criterion.label}: ${SCORE_LABELS[val]}"
    const scoreButtons = page.locator('[aria-pressed]');
    await expect(scoreButtons.first()).toBeVisible();
  });
});
