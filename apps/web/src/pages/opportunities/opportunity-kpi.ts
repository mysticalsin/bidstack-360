/**
 * Headline figures for the opportunities strip.
 *
 * An unfiltered list is the whole book, and the page only holds 50 rows, so
 * those counts come from the server summary. A stage, due, or search filter
 * is this page. Using the summary there prints the book above a shorter list.
 * Weighted revenue has no server aggregate, so it stays on the loaded rows.
 */

export interface OpportunityKpiSummary {
  opportunities: number;
  openOpportunities: number;
  pipelineValue: number;
}

export interface OpportunityKpiRow {
  value: number;
  probability: number;
  pipelineStage?: { isWon: boolean; isLost: boolean } | null;
}

export interface OpportunityKpiCard {
  key: string;
  labelKey: string;
  label: string;
  amount: number;
  money: boolean;
}

export interface OpportunityKpiView {
  scope: 'portfolio' | 'page';
  region: 'summary' | 'filtered';
  cards: OpportunityKpiCard[];
}

function isOpen(row: OpportunityKpiRow): boolean {
  return !row.pipelineStage?.isWon && !row.pipelineStage?.isLost;
}

export function opportunityKpiView(input: {
  opps: OpportunityKpiRow[];
  summary?: OpportunityKpiSummary;
  filtered: boolean;
}): OpportunityKpiView {
  const open = input.opps.filter(isOpen);
  const weighted = open.reduce((acc, row) => acc + row.value * (row.probability / 100), 0);
  const openPipeline = open.reduce((acc, row) => acc + row.value, 0);

  if (!input.filtered && input.summary) {
    return {
      scope: 'portfolio',
      region: 'summary',
      cards: [
        {
          key: 'opportunities',
          labelKey: 'oppToolbar.kpiOpportunities',
          label: 'Opportunities',
          amount: input.summary.opportunities,
          money: false,
        },
        {
          key: 'open',
          labelKey: 'oppToolbar.kpiOpenCount',
          label: 'Open',
          amount: input.summary.openOpportunities,
          money: false,
        },
        {
          key: 'openPipeline',
          labelKey: 'oppToolbar.kpiOpenPipeline',
          label: 'Open pipeline',
          amount: input.summary.pipelineValue,
          money: true,
        },
        {
          key: 'weighted',
          labelKey: 'oppToolbar.kpiWeightedRevenuePage',
          label: 'WR (page)',
          amount: weighted,
          money: true,
        },
      ],
    };
  }

  if (input.filtered) {
    return {
      scope: 'page',
      region: 'filtered',
      cards: [
        {
          key: 'opportunities',
          labelKey: 'oppToolbar.kpiOpportunitiesPage',
          label: 'Opportunities (page)',
          amount: input.opps.length,
          money: false,
        },
        {
          key: 'open',
          labelKey: 'oppToolbar.kpiOpenCountPage',
          label: 'Open (page)',
          amount: open.length,
          money: false,
        },
        {
          key: 'openPipeline',
          labelKey: 'oppToolbar.kpiOpenPipelinePage',
          label: 'Open pipeline (page)',
          amount: openPipeline,
          money: true,
        },
        {
          key: 'weighted',
          labelKey: 'oppToolbar.kpiWeightedRevenuePage',
          label: 'WR (page)',
          amount: weighted,
          money: true,
        },
      ],
    };
  }

  const bookValue = input.opps.reduce((acc, row) => acc + row.value, 0);
  return {
    scope: 'page',
    region: 'summary',
    cards: [
      {
        key: 'opportunities',
        labelKey: 'oppToolbar.kpiOpportunitiesPage',
        label: 'Opportunities (page)',
        amount: input.opps.length,
        money: false,
      },
      {
        key: 'revenue',
        labelKey: 'oppToolbar.kpiRevenuePage',
        label: 'Revenue (page)',
        amount: bookValue,
        money: true,
      },
      {
        key: 'weighted',
        labelKey: 'oppToolbar.kpiWeightedRevenuePage',
        label: 'WR (page)',
        amount: weighted,
        money: true,
      },
      {
        key: 'open',
        labelKey: 'oppToolbar.kpiOpenPage',
        label: 'Open (page)',
        amount: openPipeline,
        money: true,
      },
    ],
  };
}
