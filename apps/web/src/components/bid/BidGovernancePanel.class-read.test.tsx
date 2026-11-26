// A selected deal has no saved classification until that record arrives.
// The panel used to seed 5 FTE and offer every gate anyway. That reads as
// an unclassified bid, which the server accepts any gate for.
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => true,
}));

vi.mock('@/hooks/useBidGovernance', () => ({
  useGateDecisions: () => ({
    data: { items: [] },
    isLoading: false,
    isError: false,
    status: 'success',
  }),
  useSaveClassification: () => ({ mutate: vi.fn(), isPending: false }),
  useRecordGate: () => ({ mutate: vi.fn(), isPending: false }),
}));

const opportunityMocks = vi.hoisted(() => ({
  useOpportunity: vi.fn(),
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunity: opportunityMocks.useOpportunity,
}));

import { BidGovernancePanel } from './BidGovernancePanel';

const CHECKING = 'Checking the saved classification. The record has not arrived.';
const FAILED = 'Could not load the saved classification.';
const NONE = 'No saved classification is on this opportunity.';

function renderPanel(saved: {
  bidClass: string | null;
  fteEstimate: number | null;
  commitmentLevel: string | null;
} | null, opportunityId?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(
    <BidGovernancePanel opportunityId={opportunityId} saved={saved} />,
    { wrapper: Wrapper },
  );
}

describe('BidGovernancePanel saved classification', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not offer gates while the saved classification is still paused', () => {
    // WHY: a paused record read has isLoading false and no payload. The
    // panel must not seed 5 FTE or offer every gate for a deal that has
    // not arrived.
    opportunityMocks.useOpportunity.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    renderPanel(null, 'opp-1');

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByLabelText('Team size (FTE)')).toBeNull();
    expect(screen.queryByLabelText('Gate')).toBeNull();
    expect(screen.queryByText('No gate decisions recorded yet.')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
  });

  it('does not offer gates while the saved classification is in flight', () => {
    // WHY: a slow read also has no payload, and isLoading can stay false.
    // Every gate must not stand in for a record that is still running.
    opportunityMocks.useOpportunity.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
      error: null,
    });

    renderPanel(null, 'opp-1');

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByLabelText('Gate')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
  });

  it('keeps a failed classification read on the error', () => {
    // WHY: a failed read is not an unclassified bid. Offering every gate
    // would let a reader record a sign-off the class may not have.
    opportunityMocks.useOpportunity.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('record down'),
    });

    renderPanel(null, 'opp-1');

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByText('record down')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByLabelText('Gate')).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
  });

  it('lets a failed read win over a stale class', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // the previous FTE, and it must not offer that class's gates.
    opportunityMocks.useOpportunity.mockReturnValue({
      data: { bidClass: 'C4', fteEstimate: 45, commitmentLevel: 'xhigh' },
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('record down'),
    });

    renderPanel(null, 'opp-1');

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByLabelText('Team size (FTE)')).toBeNull();
    expect(screen.queryByLabelText('Gate')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays empty when a settled classification payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is
    // not a failed load, and it is not a default 5 FTE bid.
    opportunityMocks.useOpportunity.mockReturnValue({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    renderPanel(null, 'opp-1');

    expect(screen.getByText(NONE)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByLabelText('Gate')).toBeNull();
    expect(screen.queryByLabelText('Team size (FTE)')).toBeNull();
  });

  it('opens on a loaded class instead of the panel default', () => {
    // WHY: a loaded payload stays. Unread must not replace 45 FTE with 5,
    // and a loaded class must not be replaced by the checking line.
    opportunityMocks.useOpportunity.mockReturnValue({
      data: { bidClass: 'C4', fteEstimate: 45, commitmentLevel: 'xhigh' },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    renderPanel(null, 'opp-1');

    expect((screen.getByLabelText('Team size (FTE)') as HTMLInputElement).value).toBe('45');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
  });

  it('still shows the calculator when no opportunity is selected', () => {
    // WHY: with no deal selected, the panel is a what-if calculator. The
    // checking line must not replace that, and it must not fetch a record.
    opportunityMocks.useOpportunity.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    renderPanel(null, undefined);

    expect(screen.getByLabelText('Team size (FTE)')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(opportunityMocks.useOpportunity).toHaveBeenCalledWith(undefined);
  });

  it('still opens on a classification the caller already loaded', () => {
    // WHY: the opportunity detail page passes the loaded record. That
    // payload must stay, and a second read must not replace it.
    opportunityMocks.useOpportunity.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    renderPanel({ bidClass: 'C1', fteEstimate: 3, commitmentLevel: 'low' }, 'opp-1');

    expect((screen.getByLabelText('Team size (FTE)') as HTMLInputElement).value).toBe('3');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(opportunityMocks.useOpportunity).toHaveBeenCalledWith(undefined);
  });
});
