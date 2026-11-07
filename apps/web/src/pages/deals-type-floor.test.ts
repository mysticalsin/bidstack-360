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

// Dark --brand-primary is a fill colour (3.95:1 on the page); text needs --brand-deep.
const BRAND_TEXT = /(?:^|[\s'"`])((?:[a-z-]+:)*)text-\[var\(--brand-primary\)\]/g;

function dealsSources(): string[] {
  return DEALS_SURFACES.flatMap(sourceFiles).filter(
    (file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'),
  );
}

describe('deals type floor', () => {
  it('keeps every deals surface at 12px text or larger', () => {
    const offenders = dealsSources().flatMap((file) =>
      (readFileSync(file, 'utf8').match(BELOW_FLOOR) ?? []).map((cls) => `${relative(SRC, file)} ${cls}`),
    );
    expect(offenders).toEqual([]);
  });

  it('pairs brand-coloured text with the dark foreground token', () => {
    const offenders = dealsSources().flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          [...line.matchAll(BRAND_TEXT)]
            .filter(([, variants]) => !variants!.startsWith('dark:'))
            .filter(([, variants]) => !line.includes(`dark:${variants}text-[var(--brand-deep)]`))
            .map(([, variants]) => `${relative(SRC, file)}:${i + 1} ${variants}`),
        ),
    );
    expect(offenders).toEqual([]);
  });
});
