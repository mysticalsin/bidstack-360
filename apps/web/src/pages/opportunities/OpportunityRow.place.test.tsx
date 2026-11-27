// Demo OP-2041 is CI Financial in Canada and has no territory. The list column
// was headed Territory and the cell was the ISO code CA, so the bid looked
// assigned to a territory it does not have. A real territory name must still
// win over the country.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { i18n } from '@/i18n';
import { OpportunitiesPage } from '../OpportunitiesPage';
import { useOpportunities } from '@/hooks/useOpportunities';

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(),
  usePatchOpportunity: vi.fn(() => ({ mutate: vi.fn() })),
  useCreateOpportunity: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));

vi.mock('@/hooks/useStageMutation', () => ({
  useStageMutation: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock('@/hooks/usePipelineStages', () => ({
  usePipelineStages: vi.fn(() => ({
    data: { items: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })),
}));

vi.mock('@/hooks/useTerritories', () => ({
  useTerritorySegments: vi.fn(() => ({
    data: {
      dimension: 'industry',
      items: [],
      totals: { totalSegments: 0, totalValueMicros: 0, totalOpportunities: 0, avgProbability: 0 },
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })),
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({
    currency: 'EUR',
    convert: (value: number) => value,
    formatMoney: (value: number) => `EUR ${value.toLocaleString('en-US')}`,
    formatMoneyMicros: (micros: string | number | bigint) =>
      `EUR ${(Number(micros) / 1_000_000).toLocaleString('en-US')}`,
  }),
}));

function mockOpportunities(items: ReturnType<typeof opp>[]) {
  vi.mocked(useOpportunities).mockReturnValue({
    data: { items, nextCursor: null },
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useOpportunities>);
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OpportunitiesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function opp(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'OP-2041',
    name: 'CI Financial IT Modernization and MSP',
    customer: 'CI Financial',
    stage: 's3_technical_iteration',
    pipelineStageId: null,
    pipelineStage: null,
    value: 1_240_000,
    probability: 65,
    dueDate: '2026-07-22',
    owner: 'alex.example@example.test',
    industry: 'financial_services',
    logo: null,
    country: 'CA',
    territoryId: null,
    territoryName: null,
    updatedAt: '2026-11-01T00:00:00.000Z',
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
    ...overrides,
  };
}

describe('opportunities list place column', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
  });

  it('names Canada for demo OP-2041 and heads the column Country, not Territory', () => {
    mockOpportunities([opp()]);
    renderPage();

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Country' })).toBeTruthy();
    expect(within(table).queryByRole('columnheader', { name: 'Territory' })).toBeNull();
    expect(within(table).getByText('Canada')).toBeTruthy();
    expect(within(table).queryByText('CA')).toBeNull();
  });

  it('keeps a territory name when the bid has one, instead of swapping in the country', () => {
    mockOpportunities([
      opp({
        id: '22222222-2222-2222-2222-222222222222',
        code: 'OP-2042',
        territoryName: 'North America',
        country: 'CA',
      }),
    ]);
    renderPage();

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Territory' })).toBeTruthy();
    expect(within(table).getByText('North America')).toBeTruthy();
    expect(within(table).queryByText('Canada')).toBeNull();
    expect(within(table).queryByText('CA')).toBeNull();
  });

  it('still calls a country a country when another row on the page has a territory', () => {
    mockOpportunities([
      opp(),
      opp({
        id: '22222222-2222-2222-2222-222222222222',
        code: 'OP-2043',
        name: 'Rush University EHR Cloud Migration',
        customer: 'Rush University System for Health',
        country: 'US',
        territoryName: 'Midwest',
      }),
    ]);
    renderPage();

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Territory' })).toBeTruthy();
    expect(within(table).getByText('Midwest')).toBeTruthy();
    expect(within(table).getByText('Country: Canada. No territory on this bid.')).toBeTruthy();
  });

  it('says there is no country instead of a dash when the bid has neither', () => {
    mockOpportunities([opp({ country: null, territoryName: null })]);
    renderPage();

    const table = screen.getByRole('table');
    expect(within(table).getByText('No country')).toBeTruthy();
    expect(within(table).queryByText('\u2014')).toBeNull();
  });
});
