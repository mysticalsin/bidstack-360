// A bid read that has not settled is not an empty account. The pipeline card
// may say "No open bids" only after this account's read succeeds with none.
// A company uuid is the account, so a different customer label still counts.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { OppRow } from '@/components/viz/viz-data';

type BidRead = {
  data?: { items: OppRow[] };
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const bids = vi.hoisted(() => ({
  calls: [] as Array<string | null | undefined>,
  state: {
    data: undefined,
    isPending: true,
    isLoading: true,
    isError: false,
    isSuccess: false,
    refetch: vi.fn(),
  } as BidRead,
}));

vi.mock('@/hooks/useOpportunityRows', () => ({
  useOpportunityRows: (companyId?: string | null) => {
    bids.calls.push(companyId);
    return bids.state;
  },
}));

vi.mock('@/hooks/useAccountPeople', () => ({
  usePeopleMap: () => ({
    data: { people: [] },
    isPending: false,
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  }),
}));

import { AccountVisuals } from './AccountVisuals';

const GLOBEX = '11111111-1111-4111-8111-111111111111';

function bid(id: string, customer: string, stage: string): OppRow {
  return { id, customer, stage, value: 2_500_000, dueDate: '2026-09-01' };
}

function settled(items: OppRow[], refetch = vi.fn()): BidRead {
  return {
    data: { items },
    isPending: false,
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch,
  };
}

function renderChart(companyId: string, companyName: string) {
  render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AccountVisuals companyId={companyId} companyName={companyName} onDrill={vi.fn()} />
    </MemoryRouter>,
  );
}

function pipeline() {
  return screen.getByRole('region', { name: 'Pipeline by stage' });
}

afterEach(() => {
  bids.calls = [];
  bids.state = settled([]);
  cleanup();
});

describe('account pipeline card before the bid read settles', () => {
  it('shows a loading skeleton instead of an empty pipeline', () => {
    // WHY: a read that has not finished is not an account with no bids.
    // "No open bids" would send someone to create a deal that may already exist.
    bids.state = {
      data: undefined,
      isPending: true,
      isLoading: true,
      isError: false,
      isSuccess: false,
      refetch: vi.fn(),
    };
    renderChart(GLOBEX, 'Globex');

    const card = pipeline();
    expect(within(card).queryByText(/No open bids/)).toBeNull();
    expect(within(card).queryByText(/0 open bid/)).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Table' })).toBeNull();
    expect(within(card).getByRole('img', { name: 'Loading bids for this account' })).toBeTruthy();
    expect(card.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0);
    expect(card.querySelectorAll('.bs-shimmer').length).toBe(3);
    expect(bids.calls.at(-1)).toBe(GLOBEX);
  });

  it('shows an error and retry when the bid read fails', () => {
    // WHY: a failed read is not an empty pipeline. Retry reloads the same read.
    const refetch = vi.fn();
    bids.state = {
      data: undefined,
      isPending: false,
      isLoading: false,
      isError: true,
      isSuccess: false,
      refetch,
    };
    renderChart(GLOBEX, 'Globex');

    const card = pipeline();
    expect(within(card).queryByText(/No open bids/)).toBeNull();
    expect(within(card).queryByText(/0 open bid/)).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Table' })).toBeNull();
    expect(card.querySelector('.viz-figure')?.getAttribute('role')).toBeNull();
    expect(within(card).getByRole('alert')).toBeTruthy();
    expect(within(card).getByRole('heading', { name: "Couldn't load bids" })).toBeTruthy();
    expect(within(card).getByText('Please try again.')).toBeTruthy();
    const retry = within(card).getByRole('button', { name: 'Retry' });
    expect(retry.className).toContain('min-h-11');
    expect(retry.className).toContain('focus-visible:ring-2');
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the last bids when a later refresh fails', () => {
    // WHY: a failed refresh is not a new empty book, and it is not still loading.
    // The last successful rows stay until the retry replaces them.
    bids.state = {
      data: { items: [bid('labs', 'Globex Labs', 's1_ongoing')] },
      isPending: false,
      isLoading: false,
      isError: true,
      isSuccess: false,
      refetch: vi.fn(),
    };
    renderChart(GLOBEX, 'Globex');

    const card = pipeline();
    expect(within(card).queryByText(/No open bids/)).toBeNull();
    expect(within(card).queryByRole('img', { name: 'Loading bids for this account' })).toBeNull();
    expect(within(card).queryByRole('alert')).toBeNull();
    expect(card.textContent).toContain('1 open bid');
  });

  it('says there are no open bids only after a successful empty read', () => {
    // WHY: empty is a real result. The sentence stays for that case only.
    bids.state = settled([]);
    renderChart(GLOBEX, 'Globex');

    const card = pipeline();
    expect(within(card).getByText('No open bids for this account.')).toBeTruthy();
    expect(within(card).queryByRole('alert')).toBeNull();
    expect(card.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

describe('account pipeline card uses the company id', () => {
  it('counts a bid whose customer text is not the account name', () => {
    // WHY: the deals API already scoped this page to the company. The chart
    // must not throw that bid away because the label says Globex Labs.
    bids.state = settled([bid('labs', 'Globex Labs', 's1_ongoing')]);
    renderChart(GLOBEX, 'Globex');

    const card = pipeline();
    expect(bids.calls.at(-1)).toBe(GLOBEX);
    expect(within(card).queryByText(/No open bids/)).toBeNull();
    expect(card.textContent).toContain('1 open bid');
    fireEvent.click(within(card).getByRole('button', { name: 'Table' }));
    expect(within(card).getByRole('rowheader', { name: 'S1 ongoing' })).toBeTruthy();
  });

  it('still drops a sibling name when the cockpit id is not a uuid', () => {
    // WHY: a name-keyed route has no company id to send. Exact customer text
    // stays, and Acme Labs is not Acme.
    bids.state = settled([
      bid('exact', 'Acme', 's2_sent'),
      bid('sibling', 'Acme Labs', 's1_ongoing'),
    ]);
    renderChart('acme', 'Acme');

    const card = pipeline();
    expect(bids.calls.at(-1)).toBe('acme');
    fireEvent.click(within(card).getByRole('button', { name: 'Table' }));
    expect(within(card).getByRole('rowheader', { name: 'S2 sent' })).toBeTruthy();
    expect(within(card).queryByRole('rowheader', { name: 'S1 ongoing' })).toBeNull();
    expect(card.textContent).toContain('1 open bid');
    expect(card.textContent).not.toContain('2 open bids');
  });
});
