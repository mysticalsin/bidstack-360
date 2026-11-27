import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useTopAccounts: vi.fn(),
  useUpdateTopAccountList: vi.fn(),
  useCompanies: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/hooks/useTopAccounts', () => ({
  useTopAccounts: hookMocks.useTopAccounts,
  useUpdateTopAccountList: hookMocks.useUpdateTopAccountList,
}));

vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: hookMocks.useCompanies,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { TopAccountsSection } from './TopAccountsSection';

const CHECKING = 'Checking the top accounts. The list has not arrived.';
const EMPTY = 'No curated accounts yet';
const ERROR = "Couldn't load the current Top 10";

function topRead(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    status: 'pending',
    fetchStatus: 'paused',
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'co-northwind',
    name: 'Northwind',
    domain: 'northwind.example',
    industry: 'Software',
    logoUrl: null,
    tier: 'strategic',
    topAccountRank: 1,
    totalValue: 0,
    wonValue: 0,
    openDeals: 0,
    contactCount: 0,
    opportunityCount: 0,
    ...overrides,
  };
}

describe('TopAccountsSection curated list read', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderList(query: Record<string, unknown>) {
    hookMocks.useTopAccounts.mockReturnValue(query);
    hookMocks.useUpdateTopAccountList.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
    hookMocks.useCompanies.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
      status: 'success',
    });
    return render(<TopAccountsSection />);
  }

  // A paused read has no payload and isLoading is false. That is not an empty curation.
  it('says the list has not arrived when the read is paused', () => {
    renderList(topRead({ fetchStatus: 'paused', status: 'pending' }));

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY, { exact: false })).toBeNull();
    expect(screen.queryByText(ERROR)).toBeNull();
  });

  // An in-flight read can also report isLoading false while data is still missing.
  it('says the list has not arrived while the read is in flight', () => {
    renderList(topRead({ fetchStatus: 'fetching', status: 'pending', isLoading: false }));

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY, { exact: false })).toBeNull();
  });

  // Error wins even when isError has not flipped yet and there is no payload.
  it('says the load failed when status is error and the payload is missing', () => {
    renderList(topRead({ status: 'error', isError: false, data: undefined }));

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(ERROR)).toBeTruthy();
    expect(screen.queryByText(EMPTY, { exact: false })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  // A failed status must not keep a company that arrived on an earlier payload.
  it('does not keep a stale company when status is error', () => {
    renderList(
      topRead({
        status: 'error',
        isError: false,
        data: {
          source: 'curated',
          items: [account({ industry: null, domain: null })],
        },
      }),
    );

    expect(screen.getByText(ERROR)).toBeTruthy();
    expect(screen.queryByText('Northwind')).toBeNull();
  });

  // A failed read with isError already true stays on the error, stale company included.
  it('stays on the error when isError is true and a company is still cached', () => {
    renderList(
      topRead({
        status: 'error',
        isError: true,
        data: { source: 'curated', items: [account()] },
      }),
    );

    expect(screen.getByText(ERROR)).toBeTruthy();
    expect(screen.queryByText('Northwind')).toBeNull();
  });

  // A settled null payload is an empty curation, not a read that has not arrived.
  it('stays empty when the payload is null', () => {
    renderList(topRead({ data: null, status: 'success', fetchStatus: 'idle' }));

    expect(screen.getByText(EMPTY, { exact: false })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(ERROR)).toBeNull();
  });

  // A settled auto ranking with no curated rows is the honest empty book.
  it('stays empty when the settled list is not curated', () => {
    renderList(
      topRead({
        data: { source: 'auto', items: [] },
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect(screen.getByText(EMPTY, { exact: false })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  // A settled curated list with no rows is still empty. Zero rows is a real result.
  it('stays empty when a curated list arrived with no rows', () => {
    renderList(
      topRead({
        data: { source: 'curated', items: [] },
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect(screen.getByText(EMPTY, { exact: false })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  // A loaded account stays, including a blank industry and a zero pipeline.
  it('keeps a loaded account with a blank industry and a zero pipeline', () => {
    renderList(
      topRead({
        data: {
          source: 'curated',
          items: [account({ industry: '', domain: '', totalValue: 0, openDeals: 0 })],
        },
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect(screen.getByText('Northwind')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY, { exact: false })).toBeNull();
    expect(screen.queryByText(ERROR)).toBeNull();
  });
});
