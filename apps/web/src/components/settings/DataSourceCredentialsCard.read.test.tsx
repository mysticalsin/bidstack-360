// A paused or in-flight provider catalog has no rows yet. "No data sources"
// is a settled empty catalog. A failed read is not an empty catalog, including
// when a stale provider label is still in memory.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  isAdmin: false,
}));

const providerMocks = vi.hoisted(() => ({
  useDataProviders: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, string | number>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? '')),
  }),
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => authMocks.isAdmin,
}));

vi.mock('@/hooks/useDataProviders', () => ({
  useDataProviders: providerMocks.useDataProviders,
  useSaveDataProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveDataProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTestDataProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { DataSourceCredentialsCard } from './DataSourceCredentialsCard';

const CHECKING = 'Checking data sources. The catalog has not arrived.';
const FAILED = 'Could not load data sources';
const EMPTY = 'No data sources';

interface ReadSnapshot {
  data?: unknown;
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  status: string;
  error?: Error | null;
}

function read(partial: Partial<ReadSnapshot> & Pick<ReadSnapshot, 'status'>): ReadSnapshot {
  return {
    data: undefined,
    isLoading: false,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    ...partial,
  };
}

const paused = read({ status: 'pending', isPending: true, isLoading: false });
const inflight = read({ status: 'pending', isPending: true, isLoading: true });
const failed = read({ status: 'error', isError: true, error: new Error('offline') });

function renderCard(query: ReadSnapshot) {
  providerMocks.useDataProviders.mockReturnValue({ ...query, refetch: vi.fn() });
  return render(<DataSourceCredentialsCard />);
}

const northwind = {
  provider: 'northwind',
  label: 'Northwind Registry',
  description: 'Synthetic registry for the demo catalog.',
  docsUrl: 'https://example.test/northwind',
  configured: false,
  updatedAt: null,
};

describe('DataSourceCredentialsCard read', () => {
  afterEach(() => {
    cleanup();
    authMocks.isAdmin = false;
  });

  it('does not treat a paused catalog read as an empty source list', () => {
    // WHY: a paused first read has isLoading false and no providers. The
    // settings card must not say the API returned no sources.
    renderCard(paused);

    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight catalog read as an empty source list', () => {
    // WHY: a slow read also has no providers. A skeleton is not a settled
    // empty catalog, and it is not a failed load.
    renderCard(inflight);

    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat a failed catalog read as an empty source list', () => {
    // WHY: status error with isError still false used to fall through to the
    // empty copy. A failed read is not evidence that no sources exist.
    renderCard(read({ status: 'error', isError: false, isLoading: false }));

    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('keeps a failed catalog read on the error', () => {
    // WHY: a failed read stays on the error. An empty catalog does not stand
    // in for the read.
    renderCard(failed);

    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('lets a failed catalog read win over a stale provider', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing Northwind Registry from a list that is no longer the read.
    renderCard(
      read({
        status: 'error',
        isError: true,
        error: new Error('offline'),
        data: { items: [northwind] },
      }),
    );

    expect(screen.queryByText('Northwind Registry')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('stays empty when a settled catalog has no sources', () => {
    // WHY: a read that arrived with no sources stays empty. A slow network
    // must not be dressed up as an empty catalog, and this one must.
    renderCard(
      read({
        status: 'success',
        isSuccess: true,
        data: { items: [] },
      }),
    );

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays empty when a settled catalog payload is null', () => {
    // WHY: null is a settled payload with nothing in it. Undefined data is
    // unread. Null is not unread, and it is not a failed load.
    renderCard(
      read({
        status: 'success',
        isSuccess: true,
        data: null,
      }),
    );

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows the provider when the catalog has arrived', () => {
    // WHY: a loaded source stays. The unread line must not replace a row the
    // read already returned.
    renderCard(
      read({
        status: 'success',
        isSuccess: true,
        data: { items: [northwind] },
      }),
    );

    expect(screen.getByText('Northwind Registry')).toBeTruthy();
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
