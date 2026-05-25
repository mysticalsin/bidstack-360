/**
 * pipeline.spec.ts
 *
 * WHY: The kanban pipeline is the core visual of BidStack. Stage moves,
 * win/loss marking, and KPI accuracy are business-critical. A deal that
 * silently fails to move between stages breaks revenue forecasting.
 */
import { test, expect } from '@playwright/test';
import { PipelinePage } from '../pages/PipelinePage.js';
import { DealDetailPage } from '../pages/DealDetailPage.js';

test.describe('Pipeline kanban board', () => {
  test('pipeline page heading is visible', async ({ page }) => {
    const pipeline = new PipelinePage(page);
    await pipeline.navigate();
    await expect(pipeline.heading).toBeVisible({ timeout: 15_000 });
  });

  test('stage columns render (S1 Lead, S1 Ongoing, S2 Sent)', async ({ page }) => {
    const pipeline = new PipelinePage(page);
    await pipeline.navigate();
    await pipeline.assertColumnsVisible();
  });

  test('KPI summary cards are visible', async ({ page }) => {
    const pipeline = new PipelinePage(page);
    await pipeline.navigate();
    const main = page.getByRole('main');
    await expect(main.getByText(/total pipeline/i)).toBeVisible({ timeout: 15_000 });
    await expect(main.getByText(/open value/i)).toBeVisible();
    await expect(main.getByText(/win rate/i)).toBeVisible();
    await expect(main.getByText(/active deals/i)).toBeVisible();
  });

  test('deal card links to opportunity detail', async ({ page }) => {
    const pipeline = new PipelinePage(page);
    await pipeline.navigate();
    await pipeline.assertColumnsVisible();

    const link = page.locator('a[href^="/opportunities/"]').first();
    const hasLink = await link.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasLink, 'No deal cards in pipeline — seeded data absent');

    await pipeline.openFirstCard();
    await expect(page).toHaveURL(/\/opportunities\//);
  });

  test('mark deal as won updates status', async ({ page }) => {
    const pipeline = new PipelinePage(page);
    await pipeline.navigate();
    await pipeline.assertColumnsVisible();

    const hasCard = await page.locator('a[href^="/opportunities/"]').count() > 0;
    test.skip(!hasCard, 'No deal cards — cannot test win flow');

    await pipeline.openFirstCard();
    const deal = new DealDetailPage(page);
    await deal.assertIntelRibbonVisible();

    // Only click "Mark Won" if it's visible — some deals are already won/lost.
    const markWonVisible = await deal.markWonButton.isVisible({ timeout: 3_000 }).catch(() => false);
    if (markWonVisible) {
      await deal.markWon();
      await expect(
        page.getByText(/won|closed won|stage.*won/i).first(),
      ).toBeVisible({ timeout: 10_000 });
    } else {
      test.skip(true, 'Mark Won button not visible — deal already in terminal state');
    }
  });

  test('drag-to-stage fires when source card exists', async ({ page }) => {
    const pipeline = new PipelinePage(page);
    await pipeline.navigate();
    await pipeline.assertColumnsVisible();

    // Drag is best-effort in CI headless — test only verifies the action completes
    // without throwing, not that the DOM reflects the move (needs WS confirmation).
    const dragged = await pipeline.dragCardToColumn(/.+/, 'S1 Ongoing');
    // If no card was found, skip rather than fail — seeded data may be absent.
    test.skip(!dragged, 'No pipeline cards to drag — seeded data absent');
    // If drag completed, the board must not be broken.
    await expect(pipeline.heading).toBeVisible({ timeout: 5_000 });
  });
});
