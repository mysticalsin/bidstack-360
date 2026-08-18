import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OpportunitiesPage } from './OpportunitiesPage';
import { useOpportunities } from '@/hooks/useOpportunities';
import { useHasPermission } from '@/hooks/useCapabilities';

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(),
  usePatchOpportunity: vi.fn(() => ({ mutate: vi.fn() })),
  useCreateOpportunity: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

// Opportunity writes are gated server-side behind opportunities:write (a role
// like Presales holds read but not write) — default true here so the existing
// suite below (which doesn't care about permission) keeps seeing every
// affordance; the dedicated describe block overrides per-test.
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

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function mockOpportunities(value: Partial<ReturnType<typeof useOpportunities>>) {
  vi.mocked(useOpportunities).mockReturnValue(value as ReturnType<typeof useOpportunities>);
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function seededOpportunity() {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'OP-0001',
    name: 'Acme Upgrade',
    customer: 'Acme Corp',
    stage: 's1_lead',
    pipelineStageId: null,
    pipelineStage: null,
    value: 10000,
    probability: 20,
    dueDate: '2026-10-10',
    owner: 'owner@example.com',
    industry: 'Consulting',
    logo: null,
    country: 'FR',
    territoryId: null,
    territoryName: null,
    updatedAt: new Date().toISOString(),
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
  };
}

describe('OpportunitiesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useHasPermission).mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a loading skeleton when data is loading', () => {
    mockOpportunities({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    });

    renderWithProviders(<OpportunitiesPage />);

    // The skeleton has no explicit role, but we can verify it doesn't render the table
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders the opportunities table with seeded data', () => {
    mockOpportunities({
      data: {
        items: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            code: 'OP-0001',
            name: 'Acme Upgrade',
            customer: 'Acme Corp',
            stage: 's1_lead',
            pipelineStageId: null,
            pipelineStage: null,
            value: 10000,
            probability: 20,
            dueDate: '2026-10-10',
            owner: 'owner@example.com',
            industry: 'Consulting',
            logo: null,
            country: 'FR',
            territoryId: null,
            territoryName: null,
            updatedAt: new Date().toISOString(),
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
    });

    renderWithProviders(<OpportunitiesPage />);

    expect(screen.getByRole('heading', { name: /Opportunities/i })).toBeTruthy();
    expect(screen.getByText('Acme Upgrade')).toBeTruthy();
    expect(screen.getByText('OP-0001')).toBeTruthy();
  });

  // A1 (bid clock): the "Due ≤ 7d" quick filter must actually reach the API
  // request, not just toggle its own pressed state — a filter chip that looks
  // active but queries the unfiltered list silently hides overdue risk.
  it('wires the "Due ≤ 7d" chip to the dueWithinDays list param', () => {
    mockOpportunities({
      data: { items: [], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderWithProviders(<OpportunitiesPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Due ≤ 7d', pressed: false }));

    const lastCall = vi.mocked(useOpportunities).mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({ dueWithinDays: 7 });
    expect(lastCall).not.toHaveProperty('overdue');
  });

  it('wires the "Overdue" chip to the overdue list param and clears it on a second click', () => {
    mockOpportunities({
      data: { items: [], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderWithProviders(<OpportunitiesPage />);

    const overdueChip = () => screen.getByRole('button', { name: 'Overdue' });
    fireEvent.click(overdueChip());
    expect(vi.mocked(useOpportunities).mock.calls.at(-1)?.[0]).toMatchObject({ overdue: true });

    // Toggling the same chip again clears the filter — same UX contract as
    // the existing stage-filter chips.
    fireEvent.click(overdueChip());
    expect(vi.mocked(useOpportunities).mock.calls.at(-1)?.[0]).not.toHaveProperty('overdue');
  });

  // WHY: the zero-state is a bid team's first impression of the list — it must
  // pitch the two real ways an opportunity is born (convert a lead / log an
  // RFP) and offer a working escape hatch into the CSV importer, not a
  // generic "no data" shrug that dead-ends the user.
  it('renders the bid-specific empty state when no opportunities exist', () => {
    mockOpportunities({
      data: { items: [], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderWithProviders(<OpportunitiesPage />);

    expect(screen.getByText('No open bids yet')).toBeTruthy();
    expect(screen.getByText(/Convert a qualified lead or log the RFP/)).toBeTruthy();
    // Secondary path must land on the real CSV import wizard in Settings.
    expect(
      screen.getByRole('link', { name: /import your deal book/i }).getAttribute('href'),
    ).toBe('/settings?tab=data-import');
  });
});

// The backend 403s every opportunity PATCH/DELETE/stage-move for a role
// (e.g. Presales) that reads but doesn't write opportunities — the frontend
// must hide those affordances instead of rendering controls that always fail.
describe('OpportunitiesPage — opportunities:write gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpportunities({
      data: { items: [seededOpportunity()], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders inline cells read-only and hides bulk write controls without opportunities:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);

    renderWithProviders(<OpportunitiesPage />);

    // Stage/value/probability/date cells lose their click-to-edit trigger —
    // the underlying value stays visible, just not interactive. Scoped to the
    // table because "S1 Lead" also appears as a filter chip above it.
    const table = screen.getByRole('table');
    expect(within(table).queryByRole('button', { name: /Click to change/i })).toBeNull();
    expect(within(table).queryAllByRole('button', { name: /Click to edit/i })).toHaveLength(0);
    expect(within(table).getByText('S1 Lead')).toBeTruthy();
    expect(within(table).getByText('EUR 10,000')).toBeTruthy();

    // Selecting a row still works (read-only), but the bulk stage-move/delete
    // controls that would 403 must not render — only Clear survives.
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Acme Upgrade/i }));
    expect(screen.queryByLabelText(/Move selection to stage/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete selected/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^Clear$/i })).toBeTruthy();
  });

  it('renders inline-edit triggers and bulk write controls with opportunities:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(true);

    renderWithProviders(<OpportunitiesPage />);

    const table = screen.getByRole('table');
    expect(within(table).getByRole('button', { name: /Click to change/i })).toBeTruthy();
    expect(
      within(table).queryAllByRole('button', { name: /Click to edit/i }).length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('checkbox', { name: /Select Acme Upgrade/i }));
    expect(screen.getByLabelText(/Move selection to stage/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Delete selected/i })).toBeTruthy();
  });
});
