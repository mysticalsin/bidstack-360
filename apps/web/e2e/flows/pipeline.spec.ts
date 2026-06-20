/**
 * pipeline.spec.ts
 *
 * WHY: The kanban pipeline is the core visual of BidStack. Stage moves,
 * win/loss marking, and KPI accuracy are business-critical. A deal that
 * silently fails to move between stages breaks revenue forecasting.
 */
import { test, expect, type Page } from '@playwright/test';
import { PipelinePage } from '../pages/PipelinePage.js';
import { DealDetailPage } from '../pages/DealDetailPage.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PIPELINE_QA_PREFIX = 'E2E Pipeline QA';

type PipelineStageSettings = {
  id: string;
  name: string;
};

type PipelineStageListResponse = {
  items: PipelineStageSettings[];
};

type CreatedOpportunityResponse = {
  id: string;
};

type OpportunityDetailResponse = {
  stage: string;
  pipelineStageId: string | null;
  pipelineStage?: {
    isWon: boolean;
    isLost: boolean;
  } | null;
};

function stagePayload(stageId: string): { pipelineStageId: string } | { stage: string } {
  return UUID_RE.test(stageId) ? { pipelineStageId: stageId } : { stage: stageId };
}

async function getPipelineStage(page: Page, name: string) {
  const res = await page.request.get('/api/v1/pipeline-stages', { timeout: 10_000 });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as PipelineStageListResponse;
  const stage = body.items.find((item) => item.name === name);
  expect(stage, `configured pipeline stage ${name}`).toBeTruthy();
  return stage!;
}

async function createPipelineFixture(page: Page, stageName = 'S1 Ongoing') {
  const stage = await getPipelineStage(page, stageName);
  const marker = `${PIPELINE_QA_PREFIX} ${Date.now()}`;
  const res = await page.request.post('/api/v1/opportunities', {
    data: {
      customer: PIPELINE_QA_PREFIX,
      name: marker,
      stage: null,
      pipelineStageId: stage.id,
      value: 125_000,
      probability: 25,
      dueDate: '2026-12-31',
      owner: null,
      industry: 'technology',
      logo: null,
      country: 'US',
      territoryId: null,
    },
    timeout: 10_000,
  });
  expect(res.ok()).toBe(true);
  const created = (await res.json()) as CreatedOpportunityResponse;
  return { id: created.id, stageId: stage.id, name: marker };
}

async function deleteOpportunity(page: Page, id: string | null) {
  if (!id) return;
  const res = await page.request.delete(`/api/v1/opportunities/${id}`, { timeout: 10_000 });
  expect(res.ok() || res.status() === 404).toBe(true);
}

async function dropOpportunityOnStage(page: Page, opportunityId: string, targetStageId: string) {
  const card = page.locator(
    `[data-testid="pipeline-card"][data-opportunity-id="${opportunityId}"]`,
  );
  const dropzone = page.locator(
    `[data-testid="pipeline-column"][data-stage-id="${targetStageId}"] [data-testid="pipeline-column-dropzone"]`,
  );

  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(dropzone).toBeVisible({ timeout: 15_000 });

  await dropzone.evaluate((node, id) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', id);
    transfer.effectAllowed = 'move';
    node.dispatchEvent(
      new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
    node.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  }, opportunityId);
}

async function expectOpportunityOutcome(
  page: Page,
  opportunityId: string,
  expectedStage: 'closed_won' | 'closed_lost',
) {
  const expectedFlag = expectedStage === 'closed_won' ? 'won' : 'lost';
  await expect
    .poll(
      async () => {
        const detail = await page.request.get(`/api/v1/opportunities/${opportunityId}`, {
          timeout: 5_000,
        });
        if (!detail.ok()) return `http:${detail.status()}`;
        const body = (await detail.json()) as OpportunityDetailResponse;
        const flag =
          expectedStage === 'closed_won'
            ? body.pipelineStage?.isWon === true
            : body.pipelineStage?.isLost === true;
        const stageLink = body.pipelineStageId ? 'stage-linked' : 'stage-missing';
        return `${stageLink}:${flag ? expectedFlag : 'open'}`;
      },
      {
        message: `opportunity ${opportunityId} should persist as ${expectedStage}`,
        timeout: 15_000,
      },
    )
    .toBe(`stage-linked:${expectedFlag}`);
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

  test('opening pipeline after a cached list refetches fresh opportunities', async ({ page }) => {
    await page.goto('/opportunities');
    await expect(page.getByRole('heading', { name: 'Opportunities', level: 1 })).toBeVisible({
      timeout: 15_000,
    });

    const fixture = await createPipelineFixture(page, 'S1 Lead');

    try {
      const pipeline = new PipelinePage(page);
      await pipeline.navigate();
      await expect(
        page.locator(`[data-testid="pipeline-card"][data-opportunity-id="${fixture.id}"]`),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await deleteOpportunity(page, fixture.id);
    }
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

  test('drag-and-drop stage move updates the board and persists through the API', async ({
    page,
  }) => {
    const targetStage = await getPipelineStage(page, 'S1 Ongoing');
    const fixture = await createPipelineFixture(page, 'S1 Lead');

    const pipeline = new PipelinePage(page);
    await pipeline.navigate();
    await pipeline.assertColumnsVisible();

    try {
      await dropOpportunityOnStage(page, fixture.id, targetStage.id);

      const targetColumn = page.locator(
        `[data-testid="pipeline-column"][data-stage-id="${targetStage.id}"]`,
      );
      await expect(
        targetColumn.locator(`[data-testid="pipeline-card"][data-opportunity-id="${fixture.id}"]`),
      ).toBeVisible({ timeout: 10_000 });

      await expect
        .poll(
          async () => {
            const detail = await page.request.get(`/api/v1/opportunities/${fixture.id}`, {
              timeout: 5_000,
            });
            if (!detail.ok()) return `http:${detail.status()}`;
            const body = (await detail.json()) as { pipelineStageId: string | null; stage: string };
            return body.pipelineStageId ?? body.stage;
          },
          {
            message: `opportunity ${fixture.id} should persist after drag/drop`,
            timeout: 15_000,
          },
        )
        .toBe(targetStage.id);
    } finally {
      await deleteOpportunity(page, fixture.id);
    }
  });

  test('mark deal as won updates status', async ({ page }) => {
    const fixture = await createPipelineFixture(page, 'S1 Lead');
    const deal = new DealDetailPage(page);

    try {
      await deal.navigate(fixture.id);
      await deal.assertIntelRibbonVisible();
      await expect(deal.markWonButton).toBeVisible({ timeout: 10_000 });
      await deal.markWon();
      await expect(
        page.getByRole('button', { name: /^won$/i }),
      ).toBeVisible({ timeout: 10_000 });
      await expectOpportunityOutcome(page, fixture.id, 'closed_won');
    } finally {
      await deleteOpportunity(page, fixture.id);
    }
  });

  test('mark deal as lost updates status', async ({ page }) => {
    const fixture = await createPipelineFixture(page, 'S1 Lead');
    const deal = new DealDetailPage(page);

    try {
      await deal.navigate(fixture.id);
      await deal.assertIntelRibbonVisible();
      await expect(deal.markLostButton).toBeVisible({ timeout: 10_000 });
      await deal.markLost();
      await expect(
        page.getByRole('button', { name: /^lost$/i }),
      ).toBeVisible({ timeout: 10_000 });
      await expectOpportunityOutcome(page, fixture.id, 'closed_lost');
    } finally {
      await deleteOpportunity(page, fixture.id);
    }
  });

  test('keyboard stage move updates the board and persists through the API', async ({ page }) => {
    const fixture = await createPipelineFixture(page, 'S1 Lead');
    let chosen:
      | {
          id: string;
          sourceStageId: string;
          targetStageId: string;
          targetStageName: string;
        }
      | null = null;

    try {
      const pipeline = new PipelinePage(page);
      await pipeline.navigate();
      await pipeline.assertColumnsVisible();

      const columns = page.locator('[data-testid="pipeline-column"]');
      const columnCount = await columns.count();

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

      if (!chosen) {
        test.skip(true, 'No movable pipeline cards in seeded data');
        return;
      }
      const { id, targetStageId, targetStageName } = chosen;
      const sourceCard = page.locator(`[data-testid="pipeline-card"][data-opportunity-id="${id}"]`);

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
            const detail = await page.request.get(`/api/v1/opportunities/${id}`, { timeout: 5_000 });
            if (!detail.ok()) return `http:${detail.status()}`;
            const body = (await detail.json()) as { pipelineStageId: string | null; stage: string };
            return body.pipelineStageId ?? body.stage;
          },
          { message: `opportunity ${id} should persist in ${targetStageName}`, timeout: 15_000 },
        )
        .toBe(targetStageId);
    } finally {
      if (chosen) {
        await page.request.post(`/api/v1/opportunities/${chosen.id}/stage`, {
          data: stagePayload(chosen.sourceStageId),
          timeout: 10_000,
        });
      }
      await deleteOpportunity(page, fixture.id);
    }
  });
});
