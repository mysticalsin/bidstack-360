// A paused or in-flight company search has no rows yet. The designate
// dialog said no companies match. That read has not arrived.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useDebouncedValue', () => ({
  useDebouncedValue: (value: unknown) => value,
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: vi.fn(() => true),
}));

const hookMocks = vi.hoisted(() => ({
  useKamCandidates: vi.fn(),
  useDesignateAccount: vi.fn(),
}));

vi.mock('@/hooks/useKamAccounts', () => ({
  useKamCandidates: hookMocks.useKamCandidates,
  useDesignateAccount: hookMocks.useDesignateAccount,
}));

import { KamDesignateDialog } from './kamAccountControls';

const COMPANY = '00000000-0000-4000-8000-000000000004';
const NAME = 'Northwind';
const CHECKING = 'Checking companies. The list has not arrived.';
const FAILED = 'Could not load companies.';
const EMPTY = "No matching companies that aren't already key accounts.";
const PLACEHOLDER = 'Search companies (min. 2 characters)…';

function candidate(over: { industry?: string | null; countryCode?: string | null; domain?: string | null } = {}) {
  return {
    id: COMPANY,
    name: NAME,
    logoUrl: null,
    domain: 'northwind.example',
    industry: 'Advisory',
    countryCode: 'FR',
    ...over,
  };
}

function renderSearch(
  query: {
    data?: unknown;
    isLoading: boolean;
    isFetching: boolean;
    isError: boolean;
    status?: string;
    error?: Error | null;
    refetch?: ReturnType<typeof vi.fn>;
  },
  term = 'Nor',
) {
  const refetch = query.refetch ?? vi.fn();
  hookMocks.useKamCandidates.mockReturnValue({ ...query, refetch });
  hookMocks.useDesignateAccount.mockReturnValue({ mutate: vi.fn(), isPending: false });
  render(<KamDesignateDialog open onOpenChange={() => undefined} onDesignated={() => undefined} />);
  fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: term } });
  return { refetch };
}

function expectNoSettledList() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(FAILED)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(screen.queryByRole('option', { name: NAME })).toBeNull();
  expect(screen.queryByText(NAME)).toBeNull();
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
}

describe('Key-account candidate read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused candidate read as an empty search', () => {
    // WHY: a paused first read has isLoading false and no rows. The empty
    // sentence says the search arrived and found nothing. This one has not.
    renderSearch({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNoSettledList();
  });

  it('does not treat an in-flight candidate read as an empty search', () => {
    // WHY: a slow read also has no rows, and isLoading can stay false.
    // The empty sentence must not stand in for a read that is still running.
    renderSearch({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNoSettledList();
  });

  it('keeps a failed candidate read on the error', () => {
    // WHY: a failed read is not an unread pause and not an empty catalog.
    // Checking must not stand in for the error.
    const { refetch } = renderSearch({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('kam down'),
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(NAME)).toBeNull();
  });

  it('lets a failed read win over a stale company', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // Northwind on screen.
    renderSearch({
      data: { items: [candidate()] },
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('kam down'),
    });

    expect(screen.queryByText(NAME)).toBeNull();
    expect(screen.queryByRole('option', { name: NAME })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: error wins even when the flag has not flipped. A status of error
    // must not keep the stale company, and it must not look like no matches.
    renderSearch({
      data: { items: [candidate()] },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'error',
      error: new Error('kam down'),
    });

    expect(screen.queryByText(NAME)).toBeNull();
    expect(screen.queryByRole('option', { name: NAME })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('stays empty when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load, and it is not still checking.
    renderSearch({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NAME)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays empty when a settled search has no companies', () => {
    // WHY: an empty list has arrived. Unread must not replace that settled
    // miss, and the miss must not say the load failed.
    renderSearch({
      data: { items: [] },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NAME)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded company', () => {
    // WHY: a loaded payload stays. The unread line must not replace a company
    // the search already returned.
    renderSearch({
      data: { items: [candidate()] },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByRole('option', { name: /Northwind/ })).toBeTruthy();
    expect(screen.getByText(NAME)).toBeTruthy();
    expect(screen.getByText('FR')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded company when the industry is blank', () => {
    // WHY: a blank industry is loaded data. Unread must not drop the company,
    // and the dialog must not invent an industry or a country.
    renderSearch({
      data: { items: [candidate({ industry: null, countryCode: null, domain: null })] },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByRole('option', { name: /Northwind/ })).toBeTruthy();
    expect(screen.getByText(NAME)).toBeTruthy();
    expect(screen.queryByText('FR')).toBeNull();
    expect(screen.queryByText('Advisory')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not call a one-character search an empty list or a check in progress', () => {
    // WHY: the candidate read stays off until two characters. A shorter
    // search is not an unread company list and not a settled miss.
    renderSearch(
      {
        data: undefined,
        isLoading: false,
        isFetching: false,
        isError: false,
        status: 'pending',
        error: null,
      },
      'N',
    );

    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NAME)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
