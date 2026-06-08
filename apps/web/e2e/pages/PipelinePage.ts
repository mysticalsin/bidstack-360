/**
 * PipelinePage POM
 *
 * Covers /pipeline — the kanban board. Provides helpers for:
 *   - asserting stage columns are rendered
 *   - finding a card by title
 *   - drag-to-stage (best-effort; keyboard fallback for CI headless)
 *   - win / loss modal flows
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

const COLUMN_NAMES = [
  'S1 Lead',
  'S1 Ongoing',
  'S2 Sent',
  'S3 Technical Iteration',
  'S4 Negotiation',
  'Closed Won',
  'Closed Lost',
] as const;

export class PipelinePage {
  readonly page: Page;
  readonly heading: Locator;
  readonly kpiCards: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'Pipeline', level: 1 });
    this.kpiCards = page.getByRole('main').getByText(/total pipeline|open value|win rate|active deals/i);
  }

  async navigate(): Promise<void> {
    await this.page.goto('/pipeline', { waitUntil: 'load' });
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
  }

  column(name: (typeof COLUMN_NAMES)[number]): Locator {
    return this.page.locator(`[data-testid="pipeline-column"][data-stage-name="${name}"]`);
  }

  async assertColumnsVisible(): Promise<void> {
    // At minimum the first three columns must be visible (seeded data).
    for (const col of COLUMN_NAMES.slice(0, 3)) {
      await expect(this.column(col)).toBeVisible({ timeout: 15_000 });
    }
  }

  /**
   * Returns locator for a deal card matching the given title pattern within a
   * specific column. Useful for asserting a card moved after drag.
   */
  cardInColumn(columnName: (typeof COLUMN_NAMES)[number], titlePattern: RegExp): Locator {
    return this.column(columnName)
      .locator('[data-testid="pipeline-card"]')
      .filter({ hasText: titlePattern });
  }

  /**
   * Drag a card to a target column using Playwright drag API.
   * Falls back gracefully if the card is not found (returns false).
   */
  async dragCardToColumn(
    titlePattern: RegExp,
    targetColumn: (typeof COLUMN_NAMES)[number],
  ): Promise<boolean> {
    const card = this.page
      .locator('[data-testid="pipeline-card"]')
      .filter({ hasText: titlePattern })
      .first();
    const target = this.column(targetColumn);

    const cardVisible = await card.isVisible().catch(() => false);
    if (!cardVisible) return false;

    const dropzone = target.locator('[data-testid="pipeline-column-dropzone"]').first();
    await card.dragTo(dropzone);
    return true;
  }

  async openFirstCard(): Promise<void> {
    const card = this.page.locator('[data-testid="pipeline-card"]').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(this.page.locator('#main')).toBeVisible({ timeout: 10_000 });
  }
}
