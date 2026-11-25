// The proposals list keeps one cache entry per stage. An empty Won snapshot
// that is still inside the two-minute fresh window hides a newer all-stages
// snapshot, and the page then says the desk has no proposals. The demo book
// has a winning bid. A stage or a search that simply matched nothing is a
// filter result, not an empty desk.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

const apiMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    if (path.startsWith('/api/v1/proposals')) return Promise.resolve({ items: [], total: 0 });
    if (path.startsWith('/api/users')) return Promise.resolve({ items: [], nextCursor: null });
    return Promise.resolve({});
  }),
);
vi.mock('@/lib/api', () => ({ api: apiMock }));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));

import { ProposalsPage } from './ProposalsPage';
import type { ProposalPage } from './proposals-search-params';

/** Same key ProposalsPage passes to useQuery. */
function proposalsListQueryKey(status: string, search: string) {
  return ['proposals', 'list', { status, search }] as const;
}

const WON = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  opportunityId: '33333333-3333-4333-8333-333333333333',
  name: 'Stellantis Telematics Winning Bid',
  status: 'won' as const,
  version: 1,
  ownerId: null,
  complianceScore: 91,
  dueDate: '2026-12-25',
  createdAt: '2026-11-25T15:00:00.000Z',
  updatedAt: '2026-11-25T16:00:00.000Z',
};

const ALL_PAGE: ProposalPage = { items: [WON], total: 1 };
const EMPTY_PAGE: ProposalPage = { items: [], total: 0 };

function renderPage(client: QueryClient) {
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

function freshClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 120_000 } },
  });
}

describe('ProposalsPage empty stage cache', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockClear();
    window.history.replaceState(null, '', '/proposals');
  });

  it('shows a winning bid from a newer all-stages snapshot when the Won cache is an older empty list', async () => {
    // WHY: the demo book includes one won proposal. Won was fetched first and
    // cached empty. All-stages was fetched later and contains that bid. Won
    // is still fresh for two minutes, so the list never asks again and tells
    // the reader there are no proposals.
    const now = Date.now();
    const client = freshClient();
    client.setQueryData(proposalsListQueryKey('won', ''), EMPTY_PAGE, { updatedAt: now - 10_000 });
    client.setQueryData(proposalsListQueryKey('all', ''), ALL_PAGE, { updatedAt: now });
    window.history.replaceState(null, '', '/proposals?status=won');

    renderPage(client);

    expect(await screen.findByRole('link', { name: WON.name })).toBeTruthy();
    expect(screen.queryByText('No proposals yet.')).toBeNull();
  });

  it('does not bring a bid back when the empty stage snapshot is the newer one', async () => {
    // WHY: a newer empty Won response means the bid left that stage. The older
    // all-stages snapshot must not put it back on the Won tab.
    const now = Date.now();
    const client = freshClient();
    client.setQueryData(proposalsListQueryKey('won', ''), EMPTY_PAGE, { updatedAt: now });
    client.setQueryData(proposalsListQueryKey('all', ''), ALL_PAGE, { updatedAt: now - 10_000 });
    window.history.replaceState(null, '', '/proposals?status=won');

    renderPage(client);

    expect(await screen.findByText('No proposals match these filters.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: WON.name })).toBeNull();
    expect(screen.queryByText('No proposals yet.')).toBeNull();
  });

  it('says a stage with no rows matched nothing, and says the desk is empty only when no stage is selected', async () => {
    // WHY: "No proposals yet" means the workspace has no proposals. The demo
    // book has one in every stage. An empty Won response is that stage, not
    // the desk. A bare /proposals with an empty response is the desk.
    window.history.replaceState(null, '', '/proposals?status=won');
    const stageClient = freshClient();
    renderPage(stageClient);

    expect(await screen.findByText('No proposals match these filters.')).toBeTruthy();
    expect(screen.queryByText('No proposals yet.')).toBeNull();

    cleanup();
    window.history.replaceState(null, '', '/proposals');
    renderPage(freshClient());

    expect(await screen.findByText('No proposals yet.')).toBeTruthy();
    expect(screen.queryByText('No proposals match these filters.')).toBeNull();
  });

  it('says a search that matched nothing is a filter, not an empty desk', async () => {
    // WHY: the demo book is full. A search the server answers with an empty
    // page is that search, and the list must not say there are no proposals.
    window.history.replaceState(null, '', '/proposals?q=zzzz-no-such-bid');
    renderPage(freshClient());

    expect(await screen.findByText('No proposals match these filters.')).toBeTruthy();
    expect(screen.queryByText('No proposals yet.')).toBeNull();
  });
});
