// A paused or in-flight portfolio momentum read has no payload yet. The card
// called that a failed load. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { PortfolioMomentum as PortfolioData } from '@bidstack/shared';

interface MomentumSnapshot {
  data?: PortfolioData;
  isLoading: boolean;
  isError: boolean;
  status: string;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  refetch: () => Promise<unknown>;
}

const hookMocks = vi.hoisted(() => ({
  momentum: {
    data: undefined,
    isLoading: false,
    isError: false,
    status: 'pending',
    fetchStatus: 'idle',
    refetch: () => Promise.resolve(),
  } as MomentumSnapshot,
}));

vi.mock('@/hooks/useAccountSignals', () => ({
  usePortfolioMomentum: () => hookMocks.momentum,
}));

import { PortfolioMomentum } from './PortfolioMomentum';

const CHECKING = 'Checking momentum. The list has not arrived.';
const FAILED = "Couldn't load momentum";
const EMPTY_ACCOUNTS = 'No accounts here';
const EMPTY_ALERTS = 'No important alerts';
const ACCOUNT = 'Northwind';

const LOADED: PortfolioData = {
  accounts: [
    {
      companyId: 'northwind',
      companyName: ACCOUNT,
      score: 70,
      delta: 4,
      trend: 'gaining',
      verdict: 'Gaining traction',
      topDriver: 'pipeline',
      openPipelineMicros: '0',
      series: [70],
      sample: false,
      coverage: 1,
    },
  ],
  counts: { gaining: 1, steady: 0, declining: 0 },
  alerts: [
    {
      id: 'al-1',
      companyId: 'northwind',
      companyName: ACCOUNT,
      title: 'Northwind opened a data platform bid',
      category: 'bid',
      importance: 40,
      occurredAt: '2026-10-20T00:00:00.000Z',
      source: 'sample',
      sourceUrl: null,
      implication: 'OPPORTUNITY',
      sample: false,
    },
  ],
  accountsContinue: false,
  computedAt: '2026-10-31T00:00:00.000Z',
};

const SETTLED_EMPTY: PortfolioData = {
  accounts: [],
  counts: { gaining: 0, steady: 0, declining: 0 },
  alerts: [],
  accountsContinue: false,
  computedAt: '2026-10-31T00:00:00.000Z',
};

function settle(data: PortfolioData | undefined, extra: Partial<MomentumSnapshot> = {}) {
  hookMocks.momentum = {
    data,
    isLoading: false,
    isError: false,
    status: data === undefined ? 'pending' : 'success',
    fetchStatus: 'idle',
    refetch: () => Promise.resolve(),
    ...extra,
  };
}

function renderCard() {
  return render(
    <MemoryRouter>
      <PortfolioMomentum />
    </MemoryRouter>,
  );
}

describe('PortfolioMomentum list read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused momentum read as a failed load', () => {
    // WHY: a paused first read has isLoading false and no payload. Couldn't
    // load momentum is a failed read. The list has not arrived.
    settle(undefined, { status: 'pending', fetchStatus: 'paused' });
    renderCard();

    expect(screen.queryByRole('link', { name: ACCOUNT })).toBeNull();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(FAILED)).toHaveLength(0);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByText(EMPTY_ACCOUNTS)).toBeNull();
    expect(screen.queryByText(EMPTY_ALERTS)).toBeNull();
  });

  it('does not treat an in-flight momentum read as a failed load', () => {
    // WHY: a slow read also has no payload. A skeleton with no status is not
    // a settled empty list, and it is not a failed load.
    settle(undefined, { isLoading: true, status: 'pending', fetchStatus: 'fetching' });
    renderCard();

    expect(screen.queryByRole('link', { name: ACCOUNT })).toBeNull();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(FAILED)).toHaveLength(0);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByText(EMPTY_ACCOUNTS)).toBeNull();
    expect(screen.queryByText(EMPTY_ALERTS)).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed momentum read on the error', () => {
    // WHY: a failed read is not evidence that the list is empty. The error
    // stays, and a blank card does not stand in for the list.
    settle(undefined, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderCard();

    expect(screen.queryByRole('link', { name: ACCOUNT })).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY_ACCOUNTS)).toBeNull();
    expect(screen.queryByText(EMPTY_ALERTS)).toBeNull();
  });

  it('lets a failed read win over a stale account', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing an account from a list that is no longer the read.
    settle(LOADED, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderCard();

    expect(screen.queryByRole('link', { name: ACCOUNT })).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY_ACCOUNTS)).toBeNull();
    expect(screen.queryByText(EMPTY_ALERTS)).toBeNull();
  });

  it('stays empty when a settled momentum list has no rows', () => {
    // WHY: a list that arrived with no rows stays empty. A slow network must
    // not be dressed up as that outcome, and this one must.
    settle(SETTLED_EMPTY);
    renderCard();

    expect(screen.getByText(EMPTY_ACCOUNTS)).toBeTruthy();
    expect(screen.getByText(EMPTY_ALERTS)).toBeTruthy();
    expect(screen.queryByRole('link', { name: ACCOUNT })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows an account when the list has arrived', () => {
    // WHY: a loaded account stays. The unread line must not replace a row
    // the list already returned.
    settle(LOADED);
    renderCard();

    expect(screen.getByRole('link', { name: ACCOUNT })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Northwind opened a data platform bid' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY_ACCOUNTS)).toBeNull();
    expect(screen.queryByText(EMPTY_ALERTS)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
