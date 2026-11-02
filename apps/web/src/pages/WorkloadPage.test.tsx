// WorkloadPage — capacity flags, totals, bespoke empty, and drill-through.
//
// WHY these tests: the page exists so a bid lead can reassign work before
// deadlines slip. If the over-capacity flag stops firing at its documented
// threshold, if ownerless bids stop being counted, or if the zero state stops
// telling the lead HOW to light the screen up, the page silently degrades
// into a pretty table nobody can act on.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkloadOwner } from '@/hooks/useWorkload';

import WorkloadPage from './WorkloadPage';

const hookMocks = vi.hoisted(() => ({
  owners: [] as WorkloadOwner[],
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
  oppItems: [] as Array<Record<string, unknown>>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useWorkload', () => ({
  useWorkload: () => ({
    data: hookMocks.isLoading || hookMocks.isError ? undefined : { generatedAt: '2026-07-05T08:00:00.000Z', owners: hookMocks.owners },
    isLoading: hookMocks.isLoading,
    isError: hookMocks.isError,
    error: hookMocks.isError ? new Error('boom') : null,
    refetch: hookMocks.refetch,
  }),
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({
    currency: 'EUR',
    convert: (v: number) => v,
    formatMoney: (v: number) => `€${v}`,
    formatMoneyMicros: (micros: string | number | bigint) => `€${micros}`,
  }),
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: () => ({
    data: { items: hookMocks.oppItems, nextCursor: null },
    isLoading: false,
    isError: false,
  }),
}));

function owner(overrides: Partial<WorkloadOwner>): WorkloadOwner {
  return {
    ownerId: '11111111-1111-4111-8111-111111111111',
    name: 'Alice Bidlead',
    email: 'alice@example.com',
    openBids: 0,
    openValueMicros: '0',
    weightedValueMicros: '0',
    openTasks: 0,
    overdueTasks: 0,
    closingWithin7Days: 0,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WorkloadPage />
    </MemoryRouter>,
  );
}

describe('WorkloadPage', () => {
  beforeEach(() => {
    hookMocks.owners = [];
    hookMocks.isLoading = false;
    hookMocks.isError = false;
    hookMocks.oppItems = [];
    hookMocks.refetch.mockReset();
  });

  afterEach(() => cleanup());

  it('flags capacity per the documented thresholds and totals the desks', () => {
    hookMocks.owners = [
      // 8 live bids = over capacity (threshold OVER_CAPACITY_BIDS).
      owner({ openBids: 8, weightedValueMicros: '9000000' }),
      // 1 overdue follow-up = stretched even with a light bid count.
      owner({
        ownerId: '22222222-2222-4222-8222-222222222222',
        name: 'Bob Presales',
        email: 'bob@example.com',
        openBids: 2,
        overdueTasks: 1,
        weightedValueMicros: '4000000',
      }),
      // Zero live bids = free — the desk that can take the next RFP.
      owner({
        ownerId: '33333333-3333-4333-8333-333333333333',
        name: 'Ines Available',
        email: 'ines@example.com',
      }),
      // Ownerless bucket feeds the "Ownerless bids" KPI, not the over-capacity one.
      owner({ ownerId: null, name: null, email: null, openBids: 3, weightedValueMicros: '1000000' }),
    ];

    renderPage();

    expect(screen.getByText('Over capacity')).toBeTruthy();
    expect(screen.getByText('Stretched')).toBeTruthy();
    expect(screen.getByText('Can take a bid')).toBeTruthy();
    expect(screen.getByText('Unassigned bids')).toBeTruthy();
    expect(screen.getByTestId('workload-kpi-bids').textContent).toBe('13');
    expect(screen.getByTestId('workload-kpi-over').textContent).toBe('1');
    expect(screen.getByTestId('workload-kpi-unassigned').textContent).toBe('3');
    // Weighted total = 9M + 4M + 0 + 1M micros, formatted at the edge.
    expect(screen.getByTestId('workload-kpi-weighted').textContent).toBe('€14000000');
  });

  it('shows the bespoke zero state that tells the lead how to light it up', () => {
    hookMocks.owners = [];

    renderPage();

    expect(screen.getByText('No live bids on any desk')).toBeTruthy();
    expect(screen.getByText(/Monday-morning triage/)).toBeTruthy();
    expect(screen.getByText('Open the pipeline and assign owners')).toBeTruthy();
  });

  it('surfaces load failures with a retry instead of a blank screen', () => {
    hookMocks.isError = true;

    renderPage();

    expect(screen.getByText("Couldn't load the team's workload")).toBeTruthy();
    fireEvent.click(screen.getByText('Try again'));
    expect(hookMocks.refetch).toHaveBeenCalled();
  });

  it('drills through an expanded desk into that owner’s live bids', () => {
    hookMocks.owners = [owner({ openBids: 1, weightedValueMicros: '5000000' })];
    hookMocks.oppItems = [
      {
        id: '44444444-4444-4444-8444-444444444444',
        code: 'OP-1201',
        customer: 'Nordbahn AG',
        name: 'Signalling revamp',
        stage: 's2_sent',
        pipelineStageId: null,
        pipelineStage: null,
        value: 5,
        probability: 50,
        dueDate: null,
        owner: 'alice@example.com',
        industry: null,
        logo: null,
        country: null,
        territoryId: null,
        territoryName: null,
        updatedAt: '2026-07-01T00:00:00.000Z',
        taskCount: 0,
        commentCount: 0,
        viewCount: 0,
      },
    ];

    renderPage();

    fireEvent.click(screen.getByLabelText("Show Alice Bidlead's live bids"));

    const link = screen.getByText(/Nordbahn AG/).closest('a');
    expect(link?.getAttribute('href')).toBe(
      '/opportunities/44444444-4444-4444-8444-444444444444',
    );
  });
});
