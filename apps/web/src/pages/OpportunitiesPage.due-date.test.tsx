// Demo bids store a due date as a calendar day (OP-2041 is 2026-07-22). The
// list was formatting that day with `new Date('YYYY-MM-DD')`, which is UTC
// midnight. In America/Toronto, the org default zone, that instant is still
// the previous evening, so the Due cell showed Jul 21 while the date on the
// bid stayed 2026-07-22. The web suite pins TZ=UTC, which hides the shift.
import type { ReactElement } from 'react';

import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { useHasPermission } from '@/hooks/useCapabilities';
import { useOpportunities } from '@/hooks/useOpportunities';
import '@/i18n';

import { OpportunitiesPage } from './OpportunitiesPage';

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
      totals: {
        totalSegments: 0,
        totalValueMicros: 0,
        totalOpportunities: 0,
        avgProbability: 0,
      },
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

const DEMO_DUE = '2026-07-22';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactElement }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<OpportunitiesPage />, { wrapper: Wrapper });
}

describe('OpportunitiesPage due column', () => {
  afterEach(() => {
    cleanup();
    process.env.TZ = 'UTC';
    vi.mocked(useHasPermission).mockReturnValue(true);
  });

  it('prints the calendar day of a demo bid, not the previous evening west of UTC', () => {
    // WHY: OP-2041 is due 2026-07-22. America/Toronto reads UTC midnight on
    // that day as Jul 21, so the Due cell contradicted the date stored on
    // the bid and the overdue chip, which already counts UTC calendar days.
    process.env.TZ = 'America/Toronto';
    vi.mocked(useOpportunities).mockReturnValue({
      data: {
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            code: 'OP-2041',
            name: 'CI Financial IT Modernization',
            customer: 'CI Financial',
            stage: 's3_technical_iteration',
            pipelineStageId: null,
            pipelineStage: null,
            value: 1_240_000,
            probability: 65,
            dueDate: DEMO_DUE,
            owner: 'owner@example.com',
            industry: 'financial_services',
            logo: null,
            country: 'CA',
            territoryId: null,
            territoryName: null,
            updatedAt: '2026-11-01T15:00:00.000Z',
            taskCount: 0,
            commentCount: 0,
            viewCount: 0,
          },
        ],
        nextCursor: null,
      },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useOpportunities>);

    renderPage();

    const table = screen.getByRole('table');
    expect(within(table).getByText('Jul 22, 2026')).toBeTruthy();
    expect(within(table).queryByText('Jul 21, 2026')).toBeNull();
    expect(
      within(table).getByRole('button', { name: 'Due Jul 22, 2026. Click to edit.' }),
    ).toBeTruthy();
    // The urgency chip's accessible name is the absolute day. It has to name
    // the same calendar day the cell prints, not the previous evening.
    expect(within(table).getByLabelText('Due Jul 22, 2026')).toBeTruthy();
  });
});
