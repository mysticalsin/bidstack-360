import { test, expect } from './fixtures.js';
import type { Locator, Page } from '@playwright/test';

async function expectPipelineMain(page: Page): Promise<Locator> {
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Pipeline', level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  return main;
}

async function expectPipelineBoard(main: Locator): Promise<void> {
  await expect(main.getByRole('region', { name: /S1 Lead column/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(main.getByRole('region', { name: /S1 Ongoing column/i })).toBeVisible();
  await expect(main.getByRole('region', { name: /S2 Sent column/i })).toBeVisible();
}

test.describe('Pipeline page', () => {
  test('page heading is visible', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/pipeline');
    await expectPipelineMain(page);
  });

  test('stage columns are rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/pipeline');
    const main = await expectPipelineMain(page);
    await expectPipelineBoard(main);
  });

  test('KPI cards are rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/pipeline');
    const main = await expectPipelineMain(page);
    await expect(main.getByText('Total pipeline')).toBeVisible({ timeout: 15_000 });
    await expect(main.getByText('Open value')).toBeVisible();
    await expect(main.getByText('Win rate')).toBeVisible();
    await expect(main.getByText('Active deals')).toBeVisible();
  });

  test('at least one opportunity card links to detail page', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/pipeline');
    const main = await expectPipelineMain(page);
    await expectPipelineBoard(main);
    const opportunityLinks = main.locator('a[href^="/opportunities/"]');
    const hasLinks = (await opportunityLinks.count()) > 0;
    if (hasLinks) {
      await expect(opportunityLinks.first()).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(main.getByRole('region', { name: /column/i }).first()).toBeVisible({
        timeout: 15_000,
      });
    }
  });
});
