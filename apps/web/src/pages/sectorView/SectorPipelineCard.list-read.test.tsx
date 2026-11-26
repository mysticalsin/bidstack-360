// A paused or in-flight pipeline read has no rows yet. The card used the
// same "No open pipeline yet." line as a settled empty chart, or only the
// loading sentence. The sectors have not arrived, so that empty is not a finding.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { useAllOpportunityRows } from '@/hooks/useOpportunityRows';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

vi.mock('@/hooks/useOpportunityRows', () => ({
  useAllOpportunityRows: vi.fn(),
}));

import { useAllOpportunityRows } from '@/hooks/useOpportunityRows';
import { SectorPipelineCard } from './SectorPipelineCard';

const CHECKING = 'Checking pipeline. The chart has not arrived.';
const EMPTY = 'No open pipeline yet.';
const FAILED = 'Could not load pipeline';
const SECTOR = 'Healthcare';

type RowsQuery = ReturnType<typeof useAllOpportunityRows>;

function rowsQuery(partial: Partial<RowsQuery>): RowsQuery {
  return {
    refetch: vi.fn(),
    error: null,
    ...partial,
  } as RowsQuery;
}

function renderCard(rows: RowsQuery) {
  vi.mocked(useAllOpportunityRows).mockReturnValue(rows);
  return render(<SectorPipelineCard />);
}

function expectNoSettledEmpty() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(SECTOR)).toBeNull();
  expect(screen.queryByText(FAILED)).toBeNull();
}

const LOADED = {
  id: '11111111-1111-4111-8111-111111111111',
  stage: 'proposal',
  value: 2500,
  dueDate: '2099-01-15',
  customer: 'Northwind',
  industry: 'healthcare',
};

describe('SectorPipelineCard unread pipeline', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(useAllOpportunityRows).mockReset();
  });

  it('does not call a paused pipeline read an empty chart', async () => {
    // WHY: a paused first read has isLoading false and no payload. The card
    // said No open pipeline yet, while the sectors have not arrived.
    renderCard(
      rowsQuery({
        data: undefined,
        isError: false,
        isLoading: false,
        status: 'pending',
        fetchStatus: 'paused',
      }),
    );

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledEmpty();
  });

  it('does not call an in-flight pipeline read an empty chart', async () => {
    // WHY: a slow read said only that the pipeline was loading. A chart that
    // has not arrived is not a book with no open pipeline.
    renderCard(
      rowsQuery({
        data: undefined,
        isError: false,
        isLoading: true,
        status: 'pending',
        fetchStatus: 'fetching',
      }),
    );

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledEmpty();
    expect(screen.queryByText('Loading pipeline.')).toBeNull();
  });

  it('does not call a failed pipeline read an empty chart', async () => {
    // WHY: a failed read is not evidence that no sector has open pipeline.
    // The error stays, and the card does not say the chart is empty.
    renderCard(
      rowsQuery({
        data: undefined,
        isError: true,
        isLoading: false,
        status: 'error',
        fetchStatus: 'idle',
        error: new Error('offline'),
      }),
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(SECTOR)).toBeNull();
  });

  it('still shows a settled book that has no open pipeline', async () => {
    // WHY: a book that arrived with no open bids is empty. That sentence
    // stays, so a real empty chart is not dressed up as a slow network.
    renderCard(
      rowsQuery({
        data: { items: [], complete: true },
        isError: false,
        isLoading: false,
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(SECTOR)).toBeNull();
  });

  it('still shows a sector that has arrived', async () => {
    // WHY: a loaded sector stays on the chart. The unread line must not
    // replace a sector the read already returned.
    renderCard(
      rowsQuery({
        data: { items: [LOADED], complete: true },
        isError: false,
        isLoading: false,
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect((await screen.findAllByText(SECTOR)).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
