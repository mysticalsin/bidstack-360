// Regression: Save Score / AI Calibrate / Defend Score all persist through
// POST /api/v1/bid-scores* which is gated server-side behind bid-scores:write
// (apps/api/src/routes/bid-scores.ts:114) — before this test existed the three
// actions rendered unconditionally, a 403-on-click trap for a read-only role.
// Harness mirrors ProposalsPage.test.tsx (nuqs + router + react-query) since
// this page reads the selected opportunity off the URL.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

const bidScoreMocks = vi.hoisted(() => ({
  useBidScoreLatest: vi.fn(),
  useCreateBidScore: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false })),
  useAICalibrate: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false })),
  useBidScoreDefend: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false })),
}));
vi.mock('@/hooks/useBidScore', () => bidScoreMocks);

const opportunitiesMocks = vi.hoisted(() => ({
  useOpportunities: vi.fn(() => ({
    data: {
      items: [
        { id: 'opp-1', customer: 'Acme Corp', name: 'Big Deal', stage: 's1_lead' },
      ],
    },
    isLoading: false,
    isError: false,
  })),
}));
vi.mock('@/hooks/useOpportunities', () => opportunitiesMocks);

import { BidNoBidPage } from './BidNoBidPage';

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
  return render(<BidNoBidPage />, { wrapper: Wrapper });
}

describe('BidNoBidPage — bid-scores:write gating', () => {
  beforeEach(() => {
    bidScoreMocks.useBidScoreLatest.mockReturnValue({
      data: {
        id: 'score-1',
        criteria: {},
        totalScore: 80,
        notes: null,
        overrideJustification: null,
      },
    });
    window.history.replaceState(null, '', '/bid-matrix?opportunityId=opp-1');
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/bid-matrix');
  });

  it('shows Save Score, AI Calibrate, and Defend Score for a user with bid-scores:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);

    renderPage();

    expect(screen.getByRole('button', { name: /Save bid score/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /AI calibrate scores/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Defend score with AI/i })).toBeTruthy();
  });

  it('hides Save Score, AI Calibrate, and Defend Score for a user without bid-scores:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(false);

    renderPage();

    // The matrix itself (read access) still renders...
    expect(screen.getByText('Bid/No-Bid Decision Matrix')).toBeTruthy();
    // ...but every persist-capable action is gone, not just visually hidden.
    expect(screen.queryByRole('button', { name: /Save bid score/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /AI calibrate scores/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Defend score with AI/i })).toBeNull();
  });
});
