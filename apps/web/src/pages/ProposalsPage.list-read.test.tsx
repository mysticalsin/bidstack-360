// The proposals desk footer counts rows. Before the first payload arrives the
// count is zero, so the pagination line said "No results" next to the loading
// skeleton. A paused read is the same lie: isLoading is false, isPending is
// true, and no list has arrived. An empty desk and a failed read already have
// their own sentences and must keep them.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
    i18n: { language: 'en' },
  }),
}));

const CHECKING = 'Checking proposals. The list has not arrived.';

const NORTHWIND = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  opportunityId: null,
  name: 'Northwind Demo Proposal',
  status: 'draft' as const,
  version: 1,
  ownerId: null,
  complianceScore: null,
  dueDate: '2026-12-25',
  createdAt: '2026-11-25T15:00:00.000Z',
  updatedAt: '2026-11-25T15:00:00.000Z',
};

const apiMocks = vi.hoisted(() => ({
  api: vi.fn((path: string) => {
    if (path.startsWith('/api/users')) return Promise.resolve({ items: [], nextCursor: null });
    if (path.startsWith('/api/v1/proposals')) return Promise.resolve({ items: [], total: 0 });
    return Promise.resolve({});
  }),
}));
vi.mock('@/lib/api', () => apiMocks);

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));

import { ProposalsPage } from './ProposalsPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <NuqsAdapter>{children}</NuqsAdapter>
        </BrowserRouter>
      </QueryClientProvider>
    );
  }
  return render(<ProposalsPage />, { wrapper: Wrapper });
}

describe('ProposalsPage list read', () => {
  afterEach(() => {
    cleanup();
    onlineManager.setOnline(true);
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/proposals');
  });

  it('does not call an in-flight list empty', () => {
    // WHY: the footer reads the row count. That count is 0 until the first
    // payload arrives, so the desk said "No results" while the skeleton was
    // still up. The demo book has the Northwind proposal. It had not arrived.
    apiMocks.api.mockImplementation((path: string) => {
      if (path.startsWith('/api/users')) return Promise.resolve({ items: [], nextCursor: null });
      if (path.startsWith('/api/v1/proposals')) return new Promise(() => {});
      return Promise.resolve({});
    });

    renderPage();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText('No results')).toBeNull();
    expect(screen.queryByText('No proposals yet.')).toBeNull();
    expect(screen.getByLabelText('Loading proposals')).toBeTruthy();
  });

  it('does not call a paused list empty', () => {
    // WHY: a paused read has isLoading false and no payload. The body already
    // keeps the skeleton because the query is still pending. The footer did
    // not, and said there were no results.
    onlineManager.setOnline(false);
    apiMocks.api.mockImplementation((path: string) => {
      if (path.startsWith('/api/users')) return Promise.resolve({ items: [], nextCursor: null });
      if (path.startsWith('/api/v1/proposals')) return Promise.resolve({ items: [NORTHWIND], total: 1 });
      return Promise.resolve({});
    });

    renderPage();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText('No results')).toBeNull();
    expect(screen.queryByText('No proposals yet.')).toBeNull();
    expect(screen.queryByRole('link', { name: NORTHWIND.name })).toBeNull();
  });

  it('still says the desk is empty after a settled read with no rows', async () => {
    // WHY: a payload that arrived empty is an empty desk. The checking line
    // is only for a read that has not arrived.
    apiMocks.api.mockImplementation((path: string) => {
      if (path.startsWith('/api/users')) return Promise.resolve({ items: [], nextCursor: null });
      if (path.startsWith('/api/v1/proposals')) return Promise.resolve({ items: [], total: 0 });
      return Promise.resolve({});
    });

    renderPage();

    expect(await screen.findByText('No proposals yet.')).toBeTruthy();
    expect(screen.getByText('No results')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('keeps a failed read on the error, not on an empty desk', async () => {
    // WHY: a failed read already says the list did not load. It must not fall
    // through to "No results" or "No proposals yet."
    apiMocks.api.mockImplementation((path: string) => {
      if (path.startsWith('/api/users')) return Promise.resolve({ items: [], nextCursor: null });
      if (path.startsWith('/api/v1/proposals')) return Promise.reject(new Error('network down'));
      return Promise.resolve({});
    });

    renderPage();

    expect(await screen.findByText('Failed to load proposals')).toBeTruthy();
    expect(screen.getByText('network down')).toBeTruthy();
    expect(screen.queryByText('No results')).toBeNull();
    expect(screen.queryByText('No proposals yet.')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('shows a proposal once the list arrives', async () => {
    // WHY: the checking line is not a permanent caption. A payload that
    // arrived is the desk.
    apiMocks.api.mockImplementation((path: string) => {
      if (path.startsWith('/api/users')) return Promise.resolve({ items: [], nextCursor: null });
      if (path.startsWith('/api/v1/proposals')) {
        return Promise.resolve({ items: [NORTHWIND], total: 1 });
      }
      return Promise.resolve({});
    });

    renderPage();

    expect(await screen.findByRole('link', { name: NORTHWIND.name })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('No results')).toBeNull();
    expect(screen.queryByText('No proposals yet.')).toBeNull();
  });
});
