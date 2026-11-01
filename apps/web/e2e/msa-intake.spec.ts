import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';

import { expect, test } from './fixtures.js';

const PDF = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/northwind-msa.pdf'));
const ARTIFACT_DIR = process.env.MSA_ARTIFACT_DIR;

async function capture(page: import('@playwright/test').Page, name: string) {
  if (!ARTIFACT_DIR) return;
  if (!existsSync(ARTIFACT_DIR)) mkdirSync(ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, `${name}.png`), fullPage: true });
}

async function assertAxeClean(page: import('@playwright/test').Page, name: string) {
  await page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 5_000 })
    .catch(() => undefined);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .exclude('iframe')
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  if (blocking.length) {
    throw new Error(
      `${blocking.length} axe violations on ${name}:\n` +
        blocking.map((v) => `[${v.impact}] ${v.id}: ${v.description}`).join('\n'),
    );
  }
}

test.describe('MSA intake and leverage', () => {
  test('drop, review, confirm, then show the HEMA leverage flag', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/agreements');
    await expect(page.getByTestId('msa-intake-dropzone')).toBeVisible();
    await capture(page, 'msa_intake_dropzone');
    await assertAxeClean(page, '/agreements');

    await page.getByTestId('msa-intake-dropzone').locator('input[type="file"]').setInputFiles({
      name: 'northwind-msa.pdf',
      mimeType: 'application/pdf',
      buffer: PDF,
    });

    await expect(page.getByTestId('msa-intake-review')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Suggested:.*Northwind Pharma/i)).toBeVisible();
    await expect(page.getByTestId('msa-review-account')).toHaveValue('c0000000-0000-4000-8000-0000000000aa');
    await expect(page.getByTestId('msa-needs-ocr')).toHaveCount(0);
    await expect(page.getByText('not found').first()).toBeVisible();
    await capture(page, 'msa_intake_review');
    await assertAxeClean(page, '/agreements/intake');

    await page.getByTestId('msa-review-confirm').click();
    await expect(page.getByTestId('agreement-detail')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('msa-leverage-flag')).toBeVisible();
    await expect(page.getByTestId('msa-leverage-flag')).toContainText(/HEMA/i);
    await expect(page.getByTestId('msa-value-panel')).toBeVisible();
    await capture(page, 'msa_leverage_flag');
    await assertAxeClean(page, '/agreements/:id');

    await gotoAndWait('/dashboard');
    await expect(page.getByTestId('hema-leverage-tile')).toBeVisible();
    await expect(page.getByTestId('hema-leverage-tile')).toContainText(/HEMA/i);
    await capture(page, 'msa_hema_dashboard_tile');
  });
});
