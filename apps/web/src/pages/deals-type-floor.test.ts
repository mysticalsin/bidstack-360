import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const DEALS_SURFACES = [
  'pages/DashboardPage.tsx',
  'pages/PipelinePage.tsx',
  'pages/pipelineBoard',
  'pages/OpportunitiesPage.tsx',
  'pages/opportunities',
  'pages/OpportunityDetailPage.tsx',
  'pages/opportunityDetail',
  'pages/ForecastsPage.tsx',
  'pages/forecasts',
  'pages/WinLossPage.tsx',
  'pages/winLoss',
  'pages/BidNoBidPage.tsx',
  'pages/bidNoBid',
  'pages/SectorViewPage.tsx',
  'pages/CrossSellPage.tsx',
  'pages/AnalyticsDashboardPage.tsx',
  'pages/WorkspaceInsightsPage.tsx',
  'components/dashboard',
];

function sourceFiles(path: string): string[] {
  const abs = join(SRC, path);
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs).flatMap((name) => sourceFiles(join(path, name)));
}

const BELOW_FLOOR = /text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/g;

describe('deals type floor', () => {
  it('keeps every deals surface at 12px text or larger', () => {
    const offenders = DEALS_SURFACES.flatMap(sourceFiles)
      .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
      .flatMap((file) =>
        (readFileSync(file, 'utf8').match(BELOW_FLOOR) ?? []).map((cls) => `${relative(SRC, file)} ${cls}`),
      );
    expect(offenders).toEqual([]);
  });
});
