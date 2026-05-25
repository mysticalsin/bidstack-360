/**
 * ReportBuilderPage POM
 *
 * Covers /reports — the analytics & report builder.
 * Supports building ad-hoc reports, running them, and exporting CSV.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class ReportBuilderPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly newReportButton: Locator;
  readonly runButton: Locator;
  readonly exportCsvButton: Locator;
  readonly chartContainer: Locator;
  readonly tableContainer: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: /reports|analytics/i, level: 1 });
    this.newReportButton = page.getByRole('button', { name: /new report|create report|add report/i });
    this.runButton = page.getByRole('button', { name: /run|run report|generate/i });
    this.exportCsvButton = page.getByRole('button', { name: /export|download|csv/i });
    this.chartContainer = page.locator('[data-testid="report-chart"], .recharts-wrapper, svg.recharts-surface');
    this.tableContainer = page.locator('[data-testid="report-table"], table');
  }

  async navigate(): Promise<void> {
    await this.page.goto('/reports', { waitUntil: 'load' });
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
  }

  async openNewReport(): Promise<void> {
    await this.newReportButton.click();
    await expect(this.runButton.or(this.page.getByRole('dialog'))).toBeVisible({ timeout: 10_000 });
  }

  async runReport(): Promise<void> {
    await this.runButton.click();
    await expect(
      this.chartContainer.or(this.tableContainer).first(),
    ).toBeVisible({ timeout: 20_000 });
  }

  async exportCsv(): Promise<void> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.exportCsvButton.click(),
    ]);
    // Verify a file was downloaded
    const name = download.suggestedFilename();
    if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
      throw new Error(`Expected CSV/XLSX download, got: ${name}`);
    }
  }

  async selectMetric(metricName: string): Promise<void> {
    const metricPicker = this.page.getByRole('combobox', { name: /metric|measure/i });
    await metricPicker.selectOption({ label: metricName });
  }

  async groupBy(dimension: string): Promise<void> {
    const groupByPicker = this.page.getByRole('combobox', { name: /group by|dimension/i });
    await groupByPicker.selectOption({ label: dimension });
  }
}
