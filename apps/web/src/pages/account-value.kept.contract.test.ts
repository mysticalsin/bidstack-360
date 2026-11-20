// Kept account value: every section that gives the account team something
// concrete (financials, revenue, hiring, tech stack, org chart, agreements,
// what we have done with the account) stays on the account pages. UX changes
// may move or restyle these sections; removing one must fail here first.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const KEPT: Record<string, string[]> = {
  'src/pages/DashboardPage.tsx': [
    '<KeyNumbersStrip',
    '<WhatToPosition',
    '<PulseHero',
    '<SignalsTimeline',
    '<AccountWatchdogSection',
    '<InitiativesBoard',
    '<FinancialHealthSection',
    '<FirmographicsStrip',
    '<HiringNowCard',
    '<PotentialProjectsCard',
    '<AccountVisuals',
    '<WhoWeMetCard',
    '<OrgChartCard',
    '<AgreementsSummaryCard',
    '<KpiRow',
    '<TechStackCard',
    '<FundingEligibilityCard',
    '<BusinessSnapshotCard',
    '<OpenIssuesCard',
    '<ActivityTimelineCard',
    '<AccountNewsSignalCard',
    '<HealthScoreCard',
    '<RevenueEvolutionCard',
    '<WinLossCard',
    '<DataTrustCard',
    '<KeyContactsCard',
  ],
  'src/pages/CompanyDetailPage.tsx': [
    '<CompanyTechStackSection',
    'ContactTab',
    'OpportunityTab',
    'CasesTab',
    'NotesTab',
    'HierarchyTab',
    'employeeCount',
  ],
};

describe('account pages keep every value section', () => {
  for (const [file, sections] of Object.entries(KEPT)) {
    const src = read(file);
    for (const section of sections) {
      it(`${file} keeps ${section}`, () => {
        expect(src).toContain(section);
      });
    }
  }

  it('the account details fold starts open so tech stack and records are visible', () => {
    const fold = read('src/components/account/AccountDetailsFold.tsx');
    expect(fold).toMatch(/defaultOpen = true/);
  });
});
