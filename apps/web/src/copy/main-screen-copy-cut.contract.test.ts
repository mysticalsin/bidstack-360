// Copy cut (DESIGN.md 9.5): one title, one value, one action. Taglines,
// helper lines under KPI values and chart subtitles that restate the title are
// gone from the main screens. Values (counts, totals, criteria rated) stay.
// Pinned consent and safety copy is guarded separately in
// consent-copy.pinned.test.ts and is never part of a cut.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const CUT: Record<string, string[]> = {
  'src/pages/ProposalsPage.tsx': ["'proposals.subtitle'"],
  'src/pages/WinLossPage.tsx': [
    "'winLoss.subtitle'",
    "'winLoss.quarterChartSubtitle'",
    "'winLoss.reasonChartSubtitle'",
    "'winLoss.competitorChartSubtitle'",
  ],
  'src/pages/SectorViewPage.tsx': ["'sectorView.subtitle'"],
  'src/pages/SalesToolkitsPage.tsx': ["'salesToolkits.pageSubtitle'", "'salesToolkits.coursesSub'"],
  'src/pages/CrossSellPage.tsx': [
    "'crossSell.subtitle'",
    "'crossSell.kpiActiveHint'",
    "'crossSell.kpiOverdueHint'",
    "'crossSell.kpiUnassignedHint'",
    "'crossSell.queueNeedsOwnerHint'",
    "'crossSell.queueReadyHint'",
    "'crossSell.queueInMotionHint'",
    "'crossSell.commandQueueBody'",
  ],
  'src/pages/ForecastsPage.tsx': ["'forecasts.subtitle'"],
  'src/pages/BidNoBidPage.tsx': ["'bidNoBid.subtitle'"],
  'src/components/cockpit/PageHead.tsx': ["'pageHead.dashboardSubtitle'"],
  'src/components/dashboard/OrgDashboard.tsx': [
    "'orgDashboard.greetingMorning'",
    "'orgDashboard.greetingAfternoon'",
    "'orgDashboard.greetingEvening'",
  ],
};

const KEPT: Record<string, string[]> = {
  'src/pages/BidNoBidPage.tsx': ["'bidNoBid.criteriaRated'"],
  'src/components/dashboard/OrgDashboard.tsx': ["'orgDashboard.pageSubtitle'"],
  'src/pages/ContactsPage.tsx': ["'contacts.subtitle'"],
  'src/pages/TasksPage.tsx': ["'tasks.subtitle'"],
};

describe('main-screen copy cut', () => {
  it.each(Object.entries(CUT))('%s drops its tagline and helper copy', (file, keys) => {
    const src = read(file);
    for (const key of keys) expect(src, `${file} still renders ${key}`).not.toContain(key);
  });

  it.each(Object.entries(KEPT))('%s keeps its value line', (file, keys) => {
    const src = read(file);
    for (const key of keys) expect(src, `${file} lost ${key}`).toContain(key);
  });

  it('Forecasts header centres the action on the title once the tagline is gone', () => {
    expect(read('src/pages/ForecastsPage.tsx')).toContain(
      'className="flex flex-wrap items-center justify-between gap-3"',
    );
  });
});
