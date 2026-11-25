// The demo seed writes one proposal in every stage (seed-org-data.ts
// PROPOSALS), including a won bid. The list keeps the previous stage's
// window while the next stage loads, then filters that window by the new
// stage. Draft rows do not survive a Won filter, so the move announced
// "0 proposals" before the won request returned. A stage or search that
// itself returned nothing then said "No proposals yet.", the line for an
// empty workspace.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import { BrowserRouter, useNavigate } from 'react-router-dom';
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

const DRAFT = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  opportunityId: null,
  name: 'Siemens ERP Executive Summary',
  status: 'draft',
  version: 1,
  ownerId: null,
  complianceScore: null,
  dueDate: '2026-12-25',
  createdAt: '2026-11-25T15:00:00.000Z',
  updatedAt: '2026-11-25T15:00:00.000Z',
};

const WON = {
  ...DRAFT,
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Stellantis Telematics Winning Bid',
  status: 'won',
  complianceScore: 91,
};

const apiMocks = vi.hoisted(() => ({
  api: vi.fn((path: string) => {
    if (path.startsWith('/api/users')) return Promise.resolve({ items: [], nextCursor: null });
    return Promise.resolve({ items: [], total: 0 });
  }),
}));
vi.mock('@/lib/api', () => apiMocks);

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));

import { ProposalsPage } from './ProposalsPage';

function OpenWonStage() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/proposals?status=won')}>
      Open won stage
    </button>
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <NuqsAdapter>
            <OpenWonStage />
            {children}
          </NuqsAdapter>
        </BrowserRouter>
      </QueryClientProvider>
    );
  }
  return render(<ProposalsPage />, { wrapper: Wrapper });
}

describe('ProposalsPage stage window', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/proposals');
  });

  it('does not call the won stage empty while it is still the draft window', async () => {
    // WHY: opening Won from Draft reused the draft cache. None of those rows
    // are won, so the list said 0 proposals. The demo book has the Stellantis
    // winning bid; that request had not finished.
    let releaseWon: (page: { items: typeof WON[]; total: number }) => void = () => {};
    const wonPage = new Promise<{ items: typeof WON[]; total: number }>((resolve) => {
      releaseWon = resolve;
    });
    apiMocks.api.mockImplementation((path: string) => {
      if (path.startsWith('/api/users')) return Promise.resolve({ items: [], nextCursor: null });
      if (path.includes('status=won')) return wonPage;
      if (path.startsWith('/api/v1/proposals')) {
        // total above the loaded window so the draft cache's truncation
        // notice is on screen. It must not survive the move to Won.
        return Promise.resolve({ items: [DRAFT], total: 2 });
      }
      return Promise.resolve({});
    });
    window.history.replaceState(null, '', '/proposals?status=draft');

    renderPage();

    expect(await screen.findByRole('link', { name: DRAFT.name })).toBeTruthy();
    expect(screen.getByText(/Showing the/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open won stage' }));

    expect(await screen.findByLabelText('Loading proposals')).toBeTruthy();
    expect(screen.queryByText('0 proposals')).toBeNull();
    expect(screen.queryByText('No proposals yet.')).toBeNull();
    expect(screen.queryByText(/Showing the/)).toBeNull();
    expect(screen.queryByRole('link', { name: DRAFT.name })).toBeNull();

    releaseWon({ items: [WON], total: 1 });

    expect(await screen.findByRole('link', { name: WON.name })).toBeTruthy();
    expect(screen.queryByText('No proposals yet.')).toBeNull();
  });

  it('says a won stage with no rows is a filter miss, not an empty workspace', async () => {
    // WHY: the server already applied the stage. Zero rows means this stage
    // matched nothing. "No proposals yet." is only true when the workspace
    // itself has no proposals.
    apiMocks.api.mockImplementation((path: string) => {
      if (path.startsWith('/api/users')) return Promise.resolve({ items: [], nextCursor: null });
      if (path.startsWith('/api/v1/proposals')) return Promise.resolve({ items: [], total: 0 });
      return Promise.resolve({});
    });
    window.history.replaceState(null, '', '/proposals?status=won');

    renderPage();

    expect(await screen.findByText('No proposals match these filters.')).toBeTruthy();
    expect(screen.queryByText('No proposals yet.')).toBeNull();
  });

  it('still says the workspace has no proposals when nothing is filtered', async () => {
    apiMocks.api.mockImplementation((path: string) => {
      if (path.startsWith('/api/users')) return Promise.resolve({ items: [], nextCursor: null });
      if (path.startsWith('/api/v1/proposals')) return Promise.resolve({ items: [], total: 0 });
      return Promise.resolve({});
    });
    window.history.replaceState(null, '', '/proposals');

    renderPage();

    expect(await screen.findByText('No proposals yet.')).toBeTruthy();
  });
});
