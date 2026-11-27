import { type Page, type Route } from '@playwright/test';

/**
 * WHY: The iPad dashboard baseline compares pixels. Shard 3/3 on
 * 196838dd4 rendered CAD and 12 companies while the baseline is USD
 * and 10 companies, because the org default is CAD and sibling tests
 * share the seed. A fixed synthetic payload keeps the 2% pixel check
 * pointed at layout, not at whichever currency or company count won the race.
 */
const FROZEN_RATES = {
  base: 'USD',
  date: '2026-11-01',
  rates: {
    BRL: 5.2,
    COP: 4000,
    CLP: 950,
    CAD: 1.36,
    EUR: 0.92,
    GBP: 0.79,
    AUD: 1.52,
    CHF: 0.88,
    JPY: 150,
    SEK: 10.5,
    NOK: 10.7,
    DKK: 6.9,
  },
};

const SUMMARY = {
  companies: 4,
  contacts: 6,
  leads: 1,
  opportunities: 3,
  openOpportunities: 2,
  pipelineValue: 4_200_000,
  tasks: 3,
  overdueTasks: 1,
  serviceCases: 0,
  openServiceCases: 0,
  recentActivity: [],
};

const OPPORTUNITIES = {
  items: [
    {
      id: 'syn-won',
      stage: 'closed_won',
      value: 2_000_000,
      dueDate: '2026-10-02',
      closedAt: '2026-10-02',
      customer: 'Northwind Synthetic',
    },
    {
      id: 'syn-open-overdue',
      stage: 's2_sent',
      value: 1_500_000,
      dueDate: '2026-09-01',
      customer: 'Contoso Synthetic',
    },
    {
      id: 'syn-open-future',
      stage: 's1_ongoing',
      value: 2_700_000,
      dueDate: '2026-12-01',
      customer: 'Fabrikam Synthetic',
    },
    {
      id: 'syn-lost',
      stage: 'closed_lost',
      value: 800_000,
      dueDate: '2026-08-12',
      customer: 'Adventure Synthetic',
    },
  ],
  nextCursor: null,
};

const PIPELINE = {
  byStage: [
    { stage: 's2_sent', count: 1, valueSum: 1_500_000 },
    { stage: 's1_ongoing', count: 1, valueSum: 2_700_000 },
    { stage: 'closed_won', count: 1, valueSum: 2_000_000 },
    { stage: 'closed_lost', count: 1, valueSum: 800_000 },
  ],
  totalOpen: 2,
  totalValueOpen: 4_200_000,
  weightedPipeline: 2_100_000,
  velocity: { avgDaysOpen: 12, closedThisQuarter: 1 },
};

const WATCHDOG = {
  days: 30,
  earnings: [],
  alerts: [],
  newAlertCount: 0,
  heat: [],
  heatWeekStarts: [],
};

const PROJECTION = {
  currency: 'USD',
  generatedAt: '2026-11-15T12:00:00.000Z',
  periods: [],
};

const MOMENTUM = {
  accounts: [
    {
      companyId: 'syn-northwind',
      companyName: 'Northwind Synthetic',
      score: 62,
      delta: 4,
      trend: 'gaining',
      verdict: 'Steady synthetic account',
      topDriver: null,
      openPipelineMicros: '4200000000000',
      series: [58, 60, 62],
      sample: true,
      coverage: 1,
    },
  ],
  counts: { gaining: 1, steady: 0, declining: 0 },
  alerts: [],
  accountsContinue: false,
  computedAt: '2026-11-15T12:00:00.000Z',
};

const ACTIVITIES = { items: [], total: 0 };

const LOCALE = { currency: 'USD', dateFormat: 'YYYY-MM-DD', timezone: 'UTC' };

/** Paths the iPad dashboard screenshot reads. Anything else stays on the API. */
function syntheticBody(url: string): unknown | undefined {
  // api() rewrites /api/crm/summary to /api/v1/crm/summary before fetch.
  const path = new URL(url).pathname.replace(/\/api\/v1\//, '/api/');
  if (path.endsWith('/api/crm/summary')) return SUMMARY;
  if (path.endsWith('/api/opportunities')) return OPPORTUNITIES;
  if (path.endsWith('/api/reports/pipeline')) return PIPELINE;
  if (path.includes('/api/watchdog/feed')) return WATCHDOG;
  if (path.endsWith('/api/forecasts/projection')) return PROJECTION;
  if (path.includes('/api/portfolio/momentum')) return MOMENTUM;
  if (path.includes('/api/activities')) return ACTIVITIES;
  if (path.endsWith('/api/org-settings/locale')) return LOCALE;
  if (path.endsWith('/api/exchange-rates')) return FROZEN_RATES;
  return undefined;
}

async function fulfillSynthetic(route: Route): Promise<void> {
  if (route.request().method() !== 'GET') {
    await route.continue();
    return;
  }
  const body = syntheticBody(route.request().url());
  if (body === undefined) {
    await route.continue();
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function pinDisplayCurrency(): void {
  const persisted = {
    state: { currency: 'USD', autoDetect: false, followOrg: false, orgCurrency: 'USD' },
    version: 0,
  };
  localStorage.setItem('bidstack:currency-locale', JSON.stringify(persisted));
  localStorage.setItem('bidstack:exchange-rates', JSON.stringify({
    base: 'USD',
    date: '2026-11-01',
    rates: {
      BRL: 5.2, COP: 4000, CLP: 950, CAD: 1.36, EUR: 0.92, GBP: 0.79,
      AUD: 1.52, CHF: 0.88, JPY: 150, SEK: 10.5, NOK: 10.7, DKK: 6.9,
    },
  }));
  localStorage.setItem('bidstack:exchange-rates-ts', String(Date.now()));
}

export async function pinSyntheticDashboard(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Close-month labels and "past due" follow the page clock. Freeze it so a
  // December run does not grow a new bar or mark the December bid overdue.
  await page.clock.install({ time: new Date('2026-11-15T12:00:00.000Z') });
  await page.addInitScript(pinDisplayCurrency);
  await page.route(
    /\/api\/(?:v1\/)?(?:crm\/summary|opportunities|reports\/pipeline|watchdog\/feed|forecasts\/projection|portfolio\/momentum|activities|org-settings\/locale|exchange-rates)(?:\?|$)/,
    fulfillSynthetic,
  );
}
