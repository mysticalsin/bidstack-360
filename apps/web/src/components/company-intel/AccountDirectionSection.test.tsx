import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountDirection, AccountFinancialsIntel, AccountHiringIntel, AccountNewsIntel, IntelSourceStatus } from '@bidstack/shared';

const sources: IntelSourceStatus[] = [
  { key: 'hiring', label: 'Job boards', status: 'ok', lastFetchedAt: '2026-11-05T10:00:00Z', result: { new: 3, updated: 1, skipped: 0, failed: 0 }, detail: null },
  { key: 'posts', label: 'Company posts', status: 'never', lastFetchedAt: null, result: { new: 0, updated: 0, skipped: 0, failed: 0 }, detail: null },
  { key: 'financials', label: 'Filings', status: 'partial', lastFetchedAt: '2026-11-04T10:00:00Z', result: { new: 2, updated: 0, skipped: 0, failed: 1 }, detail: 'SEC EDGAR: HTTP 503' },
  { key: 'registry', label: 'Registries', status: 'not_configured', lastFetchedAt: null, result: { new: 0, updated: 0, skipped: 0, failed: 0 }, detail: 'Set ACCOUNT_INTEL_USER_AGENT' },
];

const evidence = [
  { id: 'fin:2025', source: 'esef', sourceLabel: 'ESEF (filings.xbrl.org)', url: 'https://filings.xbrl.org/r-2025', fetchedAt: '2026-11-04T10:00:00Z', excerpt: 'Revenue FY2025: 1,100,000,000 EUR (ifrs-full:Revenue)', locator: 'FY2025', sample: false },
  { id: 'job:1', source: 'greenhouse', sourceLabel: 'Greenhouse', url: 'https://boards.greenhouse.io/x/jobs/1', fetchedAt: '2026-11-05T10:00:00Z', excerpt: 'Data Engineer, Databricks (Oslo)', locator: null, sample: false },
];

const direction: AccountDirection = {
  companyId: 'c1',
  companyName: 'Acme',
  computedAt: '2026-11-06T10:00:00Z',
  headline: { id: 'h', area: 'direction', text: 'Heading toward data and AI', basis: 'inferred', theme: 'data_ai', evidenceIds: ['fin:2025', 'job:1'] },
  claims: [
    { id: 'c-fin', area: 'financials', text: 'Revenue up 10% in FY2025', basis: 'observed', theme: null, evidenceIds: ['fin:2025'] },
    { id: 'c-hire', area: 'hiring', text: '3 open roles', basis: 'observed', theme: null, evidenceIds: ['job:1'] },
  ],
  investing: [{ id: 'i1', direction: 'investing', area: 'capex', theme: null, label: 'Capex', amount: 120e6, currency: 'EUR', trendPct: 50, basis: 'observed', summary: 'Capex up 50% in FY2025', evidenceIds: ['fin:2025'] }],
  cutting: [],
  next12: [{ id: 'n1', direction: 'next12', area: 'theme', theme: 'data_ai', label: 'Data and AI', amount: null, currency: null, trendPct: null, basis: 'inferred', summary: 'Hiring and own posts point to data and AI', evidenceIds: ['job:1'] }],
  bidRelevance: [{ theme: 'data_ai', label: 'Data and AI', offering: 'Data and AI practice', pitch: 'Data platform squads.', nextStep: 'Offer a data platform health check.', score: 3, evidenceIds: ['job:1'] }],
  evidence,
  sources,
  sample: false,
};

const hiring: AccountHiringIntel = {
  companyId: 'c1',
  summary: { openRoles: 3, posted30: 2, postedPrev30: 1, posted90: 3, postedPrev90: 0, trend30Pct: 100, trend90Pct: null, monthly: [0, 0, 0, 1, 1, 1], byFunction: [{ key: 'data', label: 'Data', count: 2 }, { key: 'finance', label: 'Finance', count: 1 }], skills: [{ skill: 'Databricks', count: 1, theme: 'data_ai' }], sources: ['greenhouse'] },
  postings: [{ id: '1', title: 'Data Engineer, Databricks', department: 'Technology', function: 'data', location: 'Oslo', seniority: 'senior', skills: ['Databricks'], postedAt: '2026-11-01T00:00:00Z', url: 'https://boards.greenhouse.io/x/jobs/1', source: 'greenhouse', sample: false }],
  sample: false,
};

const financials: AccountFinancialsIntel = {
  companyId: 'c1',
  years: [
    { fiscalYear: 2024, periodEnd: '2024-12-31', currency: 'EUR', source: 'ESEF (filings.xbrl.org)', sourceUrl: 'https://filings.xbrl.org/r-2024', revenue: 1000e6, operatingMargin: 10, netMargin: 7, capex: 80e6, rnd: 20e6, acquisitions: null, intangibles: null, debtIssued: null, cash: null, debt: null, headcount: null, restructuring: null, sample: false, evidenceId: 'fin:2024' },
    { fiscalYear: 2025, periodEnd: '2025-12-31', currency: 'EUR', source: 'ESEF (filings.xbrl.org)', sourceUrl: 'https://filings.xbrl.org/r-2025', revenue: 1100e6, operatingMargin: 12, netMargin: 8, capex: 120e6, rnd: 22e6, acquisitions: null, intangibles: null, debtIssued: null, cash: null, debt: null, headcount: null, restructuring: null, sample: false, evidenceId: 'fin:2025' },
  ],
  revenueFallback: null,
  registry: [],
  sample: false,
};

const news: AccountNewsIntel = {
  companyId: 'c1',
  items: [{ id: 'p1', origin: 'own', kind: 'acquisition', title: 'Acme acquires PayCo', url: 'https://acme.example/payco', publishedAt: '2026-10-26T07:00:00Z', source: 'newsroom', sourceLabel: 'Company newsroom', sample: false, evidenceId: 'post:p1' }],
  sample: false,
};

const refresh = vi.fn();
const state = { direction: direction as AccountDirection | undefined };
vi.mock('@/hooks/useCompanyIntel', () => ({
  useCompanyDirection: () => ({ data: state.direction, isLoading: false, isError: false, refetch: vi.fn() }),
  useCompanyHiringIntel: () => ({ data: hiring, isLoading: false, isError: false }),
  useCompanyFinancialsIntel: () => ({ data: financials, isLoading: false, isError: false }),
  useCompanyNewsIntel: () => ({ data: news, isLoading: false, isError: false }),
  useRefreshIntelSource: () => ({ mutate: refresh, isPending: false, variables: undefined }),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));

import { AccountDirectionSection } from './AccountDirectionSection';

describe('AccountDirectionSection', () => {
  afterEach(() => {
    cleanup();
    refresh.mockReset();
    state.direction = direction;
  });

  it('opens on the direction view with cited claims and inferred labels', () => {
    render(<AccountDirectionSection companyId="c1" />);
    expect(screen.getByRole('tab', { name: 'Direction', selected: true })).toBeTruthy();
    expect(screen.getByText('Heading toward data and AI')).toBeTruthy();
    expect(screen.getAllByText('Inferred').length).toBeGreaterThan(0);
    const claim = screen.getByTestId('claim-c-fin');
    expect(within(claim).getByRole('link', { name: /ESEF/ }).getAttribute('href')).toBe('https://filings.xbrl.org/r-2025');
    expect(screen.getByText('Data and AI practice')).toBeTruthy();
  });

  it('switches to hiring, financials and news tabs', () => {
    render(<AccountDirectionSection companyId="c1" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Hiring' }));
    expect(screen.getByTestId('intel-open-roles').textContent).toContain('3');
    expect(screen.getAllByText('Databricks').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Financials' }));
    expect(screen.getByTestId('intel-fin-year-2025')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'News and posts' }));
    expect(screen.getByText('Acme acquires PayCo')).toBeTruthy();
    expect(screen.getByText('Acquisition')).toBeTruthy();
  });

  it('shows each source with last fetch and result, and refreshes one source', () => {
    render(<AccountDirectionSection companyId="c1" />);
    const row = screen.getByTestId('intel-source-financials');
    expect(row.textContent).toMatch(/2 new/);
    expect(row.textContent).toMatch(/1 failed/);
    expect(screen.getByTestId('intel-source-registry').textContent).toMatch(/ACCOUNT_INTEL_USER_AGENT/);
    fireEvent.click(within(screen.getByTestId('intel-source-posts')).getByRole('button', { name: /Refresh Company posts/ }));
    expect(refresh).toHaveBeenCalledWith('posts');
  });

  it('labels fixture data as Sample', () => {
    state.direction = { ...direction, sample: true };
    render(<AccountDirectionSection companyId="c1" />);
    expect(screen.getByText('Sample')).toBeTruthy();
  });
});
