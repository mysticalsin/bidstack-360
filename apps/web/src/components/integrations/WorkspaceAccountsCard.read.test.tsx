// A paused or in-flight workspace read has no payload yet. The card drew an
// empty list. That read has not arrived.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface WorkspaceProvider {
  provider: 'google' | 'microsoft';
  configured: boolean;
  status: 'connected' | 'disconnected' | 'error' | 'revoked';
  accountEmail: string | null;
  scopes: Array<{ key: string; label: string; access: 'read' | 'write' }>;
  lastSyncedAt: string | null;
  connectedAt: string | null;
  errorMessage: string | null;
}

interface WorkspaceSnapshot {
  data?: { providers: WorkspaceProvider[] };
  isLoading: boolean;
  isError: boolean;
  status: string;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  error: Error | null;
  refetch: () => Promise<unknown>;
}

const hookMocks = vi.hoisted(() => ({
  query: {
    data: undefined,
    isLoading: false,
    isError: false,
    status: 'pending',
    fetchStatus: 'idle',
    error: null,
    refetch: () => Promise.resolve(),
  } as WorkspaceSnapshot,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: () => hookMocks.query,
  };
});

import { WorkspaceAccountsCard } from './WorkspaceAccountsCard';

const CHECKING = 'Checking email and calendar. The list has not arrived.';
const FAILED = 'Could not load accounts';
const MAILBOX = 'rep@example.test';

const LOADED: WorkspaceProvider = {
  provider: 'google',
  configured: true,
  status: 'connected',
  accountEmail: MAILBOX,
  scopes: [{ key: 'mail_read', label: 'Read your email', access: 'read' }],
  lastSyncedAt: '2026-11-06T14:00:00.000Z',
  connectedAt: '2026-11-01T14:00:00.000Z',
  errorMessage: null,
};

function settle(data: { providers: WorkspaceProvider[] } | undefined, extra: Partial<WorkspaceSnapshot> = {}) {
  hookMocks.query = {
    data,
    isLoading: false,
    isError: false,
    status: data === undefined ? 'pending' : 'success',
    fetchStatus: 'idle',
    error: null,
    refetch: () => Promise.resolve(),
    ...extra,
  };
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<WorkspaceAccountsCard />, { wrapper: Wrapper });
}

describe('WorkspaceAccountsCard read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused workspace read as an empty list', () => {
    // WHY: a paused first read has isLoading false and no payload. An empty
    // list is a settled read. The list has not arrived.
    settle(undefined, { status: 'pending', fetchStatus: 'paused' });
    renderCard();

    expect(screen.queryByText('Google Workspace')).toBeNull();
    expect(screen.queryByText(MAILBOX)).toBeNull();
    expect(screen.queryByText('Not connected')).toBeNull();
    expect(screen.queryByText('Not set up')).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight workspace read as an empty list', () => {
    // WHY: a slow read also has no payload. A skeleton with no status is not
    // a settled list, and it is not a failed load.
    settle(undefined, { isLoading: true, status: 'pending', fetchStatus: 'fetching' });
    renderCard();

    expect(screen.queryByText('Google Workspace')).toBeNull();
    expect(screen.queryByText(MAILBOX)).toBeNull();
    expect(screen.queryByText('Not connected')).toBeNull();
    expect(screen.queryByText('Not set up')).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed workspace read on the error', () => {
    // WHY: a failed read is not evidence that no mailbox is connected. The
    // error stays, and a blank list does not stand in for the record.
    settle(undefined, { isError: true, status: 'error', fetchStatus: 'idle', error: new Error('boom') });
    renderCard();

    expect(screen.queryByText('Google Workspace')).toBeNull();
    expect(screen.queryByText(MAILBOX)).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('lets a failed read win over a stale mailbox', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing a mailbox from a read that is no longer current.
    settle({ providers: [LOADED] }, { isError: true, status: 'error', fetchStatus: 'idle', error: new Error('boom') });
    renderCard();

    expect(screen.queryByText('Google Workspace')).toBeNull();
    expect(screen.queryByText(MAILBOX)).toBeNull();
    expect(screen.queryByText('Connected')).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('stays empty when a settled read has no providers', () => {
    // WHY: a list that arrived with no providers stays empty. A slow network
    // must not be dressed up as that outcome, and this one must.
    settle({ providers: [] });
    renderCard();

    expect(screen.getByRole('heading', { name: 'Email and calendar' })).toBeTruthy();
    expect(screen.getByRole('list')).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.queryByText('Google Workspace')).toBeNull();
    expect(screen.queryByText('Not connected')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a mailbox when the read has arrived', () => {
    // WHY: a loaded mailbox stays. The unread line must not replace an
    // address the read already returned.
    settle({ providers: [LOADED] });
    renderCard();

    expect(screen.getByRole('heading', { name: 'Email and calendar' })).toBeTruthy();
    expect(screen.getByText('Google Workspace')).toBeTruthy();
    expect(screen.getByText(MAILBOX)).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
