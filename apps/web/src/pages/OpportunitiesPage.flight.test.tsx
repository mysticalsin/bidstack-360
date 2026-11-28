// The demo book leaves Stellantis (closed_won) and Spotify (closed_lost) on the
// opportunities page with the open bids. The subtitle used the page length, so
// that page read as bids in flight. The rows stay. The sentence has to count
// only the open ones and say the rest are closed.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OpportunitiesPage } from './OpportunitiesPage';
import { useOpportunities } from '@/hooks/useOpportunities';

// The page test has no i18next instance, so the real t() leaves "{{count}}"
// in the subtitle. Production interpolates. This stub does the same replacement
// the catalog does, and nothing else.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback ?? key;
      return String(fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(values[name] ?? ''),
      );
    },
  }),
}));

vi.mock('@/hooks/useOrgSummary', () => ({
  useOrgSummary: () => ({ data: undefined, isLoading: false, isError: false }),
}));

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

function mockOpportunities(items: ReturnType<typeof demoRow>[], nextCursor: string | null = null) {
  vi.mocked(useOpportunities).mockReturnValue({
    data: { items, nextCursor },
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useOpportunities>);
}

function demoRow(patch: Record<string, unknown>) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'OP-0001',
    name: 'Global ERP Modernization',
    customer: 'Siemens',
    stage: 's3_technical_iteration',
    pipelineStageId: null,
    pipelineStage: null,
    value: 1_200_000,
    probability: 60,
    dueDate: '2026-12-01',
    owner: 'owner@example.com',
    industry: 'Manufacturing',
    logo: null,
    country: 'DE',
    territoryId: null,
    territoryName: null,
    updatedAt: '2026-11-01T00:00:00.000Z',
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
    ...patch,
  };
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

describe('OpportunitiesPage in-flight subtitle', () => {
  afterEach(() => cleanup());

  it('does not call decided demo bids bids in flight', () => {
    mockOpportunities([
      demoRow({}),
      demoRow({
        id: '22222222-2222-2222-2222-222222222222',
        code: 'OP-0005',
        customer: 'Stellantis',
        name: 'EV Fleet Telematics',
        stage: 'closed_won',
        probability: 100,
        value: 620_000,
        industry: 'Automotive',
        country: 'IT',
      }),
      demoRow({
        id: '33333333-3333-3333-3333-333333333333',
        code: 'OP-0006',
        customer: 'Spotify',
        name: 'Data Lakehouse Build',
        stage: 'closed_lost',
        probability: 0,
        value: 430_000,
        industry: 'Media',
        country: 'SE',
      }),
    ]);

    renderPage();

    const subtitle = screen.getByRole('heading', { name: 'Opportunities' }).parentElement;
    expect(subtitle?.textContent).toContain('1 bids in flight · 2 closed on this page.');
    expect(subtitle?.textContent).not.toContain('3 bids in flight');
    // The closed rows stay on the page. The screen-reader count is still
    // every opportunity, not the in-flight subset.
    expect(screen.getByText('EV Fleet Telematics')).toBeTruthy();
    expect(screen.getByText('Data Lakehouse Build')).toBeTruthy();
    expect(screen.getByText('3 opportunities', { selector: 'p' })).toBeTruthy();
  });

  it('says the in-flight count is this page when another page exists', () => {
    mockOpportunities(
      [
        demoRow({}),
        demoRow({
          id: '22222222-2222-2222-2222-222222222222',
          code: 'OP-0005',
          customer: 'Stellantis',
          name: 'EV Fleet Telematics',
          stage: 'closed_won',
          probability: 100,
          value: 620_000,
        }),
      ],
      'next-page',
    );
    renderPage();
    const subtitle = screen.getByRole('heading', { name: 'Opportunities' }).parentElement;
    expect(subtitle?.textContent).toContain(
      '1 bids in flight on this page · 1 closed on this page.',
    );
  });

  it('keeps the in-flight sentence when every row on the page is open', () => {
    mockOpportunities([demoRow({})]);
    renderPage();
    const subtitle = screen.getByRole('heading', { name: 'Opportunities' }).parentElement;
    expect(subtitle?.textContent).toContain('1 bids in flight · click any cell to edit inline.');
    expect(subtitle?.textContent).not.toContain('closed on this page');
  });
});
