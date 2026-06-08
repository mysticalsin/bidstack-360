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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stagePayload(stageId: string): { pipelineStageId: string } | { stage: string } {
  return UUID_RE.test(stageId) ? { pipelineStageId: stageId } : { stage: stageId };
}

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

    const card = page.locator('[data-testid="pipeline-card"]').first();
    const hasCard = await card.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasCard, 'No deal cards in pipeline — seeded data absent');

    await pipeline.openFirstCard();
    await expect(page).toHaveURL(/\/opportunities\//);
  });

  test('mark deal as won updates status', async ({ page }) => {
    const pipeline = new PipelinePage(page);
    await pipeline.navigate();
    await pipeline.assertColumnsVisible();

    const hasCard = (await page.locator('[data-testid="pipeline-card"]').count()) > 0;
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

  test('keyboard stage move updates the board and persists through the API', async ({ page }) => {
    const pipeline = new PipelinePage(page);
    await pipeline.navigate();
    await pipeline.assertColumnsVisible();

    const columns = page.locator('[data-testid="pipeline-column"]');
    const columnCount = await columns.count();
    let chosen:
      | {
          id: string;
          sourceStageId: string;
          targetStageId: string;
          targetStageName: string;
        }
      | null = null;

    for (let i = 0; i < columnCount - 1; i += 1) {
      const source = columns.nth(i);
      const card = source.locator('[data-testid="pipeline-card"]').first();
      if ((await card.count()) === 0) continue;

      const id = await card.getAttribute('data-opportunity-id');
      const sourceStageId = await source.getAttribute('data-stage-id');
      const targetStageId = await columns.nth(i + 1).getAttribute('data-stage-id');
      const targetStageName = await columns.nth(i + 1).getAttribute('data-stage-name');
      if (id && sourceStageId && targetStageId && targetStageName) {
        chosen = { id, sourceStageId, targetStageId, targetStageName };
        break;
      }
    }

    test.skip(!chosen, 'No movable pipeline cards in seeded data');
    const { id, sourceStageId, targetStageId, targetStageName } = chosen;
    const sourceCard = page.locator(`[data-testid="pipeline-card"][data-opportunity-id="${id}"]`);

    try {
      await sourceCard.focus();

      await sourceCard.press('ArrowRight');
      const targetColumn = page.locator(
        `[data-testid="pipeline-column"][data-stage-id="${targetStageId}"]`,
      );
      await expect(
        targetColumn.locator(`[data-testid="pipeline-card"][data-opportunity-id="${id}"]`),
      ).toBeVisible({ timeout: 10_000 });

      await expect
        .poll(
          async () => {
            const detail = await page.request.get(`/api/opportunities/${id}`, { timeout: 5_000 });
            if (!detail.ok()) return `http:${detail.status()}`;
            const body = (await detail.json()) as { pipelineStageId: string | null; stage: string };
            return body.pipelineStageId ?? body.stage;
          },
          { message: `opportunity ${id} should persist in ${targetStageName}`, timeout: 15_000 },
        )
        .toBe(targetStageId);
    } finally {
      await page.request.post(`/api/opportunities/${id}/stage`, {
        data: stagePayload(sourceStageId),
        timeout: 10_000,
      });
    }
  });
});
