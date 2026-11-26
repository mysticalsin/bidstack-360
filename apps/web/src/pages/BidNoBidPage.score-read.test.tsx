// A paused, in-flight, or failed latest score has no matrix yet. The page used
// the same "Not yet rated" line and the same composite of 0 as a deal whose
// score read settled with no row. The score has not arrived, so it is not zero.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback?: string | Record<string, unknown>,
      values?: Record<string, unknown>,
    ) => {
      const template = typeof fallback === 'string' ? fallback : _key;
      const vars = typeof fallback === 'object' && fallback ? fallback : values;
      if (!vars) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));
    },
  }),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: apiMock,
}));

import { ApiError } from '@/lib/api';
import { BidNoBidPage } from './BidNoBidPage';

const OPPORTUNITY_ID = '33333333-3333-4333-8333-333333333333';
const SCORE_PATH = `/api/v1/bid-scores/${OPPORTUNITY_ID}/latest`;
const CAPABILITIES_PATH = '/api/me/capabilities';
const NOT_YET = 'Not yet rated';
const SCORE_ZERO = 'Overall bid score: 0%';
const RATIO_ZERO = '0/10';
const ZERO_LINE = 'Unrated criteria count as zero in the composite.';
const WAITING = 'Checking the bid score. The score has not arrived.';
const FAILED = 'Could not load the bid score.';
const SCORE_READY = 'Overall bid score: 14%';

const CAPABILITIES = {
  userId: 'user-1',
  orgId: '11111111-1111-4111-8111-111111111111',
  legacyRole: 'admin',
  roles: ['admin'],
  permissions: ['bid-scores:write', 'opportunities:read', 'opportunities:write'],
  isAdmin: true,
};

const OPPORTUNITY = {
  id: OPPORTUNITY_ID,
  customer: 'Northwind Demo',
  name: 'Harbor renewal',
  stage: 's2_qualify',
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
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

function hang(): Promise<never> {
  return new Promise(() => {});
}

function isScore(path: string): boolean {
  return path === SCORE_PATH;
}

function isOpportunities(path: string): boolean {
  return path.startsWith('/api/opportunities?');
}

function isGates(path: string): boolean {
  return path === `/api/opportunities/${OPPORTUNITY_ID}/gate-decisions`;
}

function withShell(
  score: (path: string) => Promise<unknown>,
): (path: string) => Promise<unknown> {
  return (path: string) => {
    if (path === CAPABILITIES_PATH) return Promise.resolve(CAPABILITIES);
    if (isOpportunities(path)) return Promise.resolve({ items: [OPPORTUNITY] });
    if (isGates(path)) return Promise.resolve({ items: [] });
    return score(path);
  };
}

describe('BidNoBidPage unread score', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
    window.history.replaceState(null, '', '/bid-matrix');
  });

  it('does not call a paused bid score unrated or zero', async () => {
    // WHY: a paused first read has isLoading false and no score. The matrix
    // said Not yet rated and showed a composite of 0, while the score has
    // not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);
    window.history.replaceState(null, '', `/bid-matrix?opportunityId=${OPPORTUNITY_ID}`);

    renderPage();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(NOT_YET)).toBeNull();
    expect(screen.queryByRole('group', { name: SCORE_ZERO })).toBeNull();
    expect(screen.queryByText(RATIO_ZERO)).toBeNull();
    expect(screen.queryByText(ZERO_LINE)).toBeNull();
  });

  it('does not call an in-flight bid score unrated or zero', async () => {
    // WHY: a slow read is not an unscored deal. The composite of 0 and the
    // Not yet rated line belong to a score that has arrived empty.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);
    window.history.replaceState(null, '', `/bid-matrix?opportunityId=${OPPORTUNITY_ID}`);

    renderPage();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(NOT_YET)).toBeNull();
    expect(screen.queryByRole('group', { name: SCORE_ZERO })).toBeNull();
    expect(screen.queryByText(RATIO_ZERO)).toBeNull();
    expect(screen.queryByText(ZERO_LINE)).toBeNull();
  });

  it('does not call a failed bid score unrated or zero', async () => {
    // WHY: a failed read is not evidence the deal is unscored. The error
    // stays, and the page does not show a composite of 0.
    apiMock.mockImplementation(
      withShell((path: string) => {
        if (isScore(path)) return Promise.reject(new ApiError('network down', 500, null));
        return Promise.reject(new Error(`unhandled: ${path}`));
      }),
    );
    window.history.replaceState(null, '', `/bid-matrix?opportunityId=${OPPORTUNITY_ID}`);

    renderPage();

    expect(await screen.findByRole('alert', { name: FAILED }, { timeout: 10000 })).toBeTruthy();
    expect(screen.queryByText(NOT_YET)).toBeNull();
    expect(screen.queryByRole('group', { name: SCORE_ZERO })).toBeNull();
    expect(screen.queryByText(RATIO_ZERO)).toBeNull();
    expect(screen.queryByText(ZERO_LINE)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  }, 15000);

  it('still says a settled score found none', async () => {
    // WHY: a 404 means the read arrived and the deal has no score. That
    // line stays Not yet rated, and the composite stays 0, so a real miss
    // is not dressed up as a slow network.
    apiMock.mockImplementation(
      withShell((path: string) => {
        if (isScore(path)) {
          return Promise.reject(
            new ApiError('No bid score found for this opportunity', 404, null),
          );
        }
        return Promise.reject(new Error(`unhandled: ${path}`));
      }),
    );
    window.history.replaceState(null, '', `/bid-matrix?opportunityId=${OPPORTUNITY_ID}`);

    renderPage();

    expect(await screen.findByText(NOT_YET)).toBeTruthy();
    expect(screen.getByRole('group', { name: SCORE_ZERO })).toBeTruthy();
    expect(screen.getByText(RATIO_ZERO)).toBeTruthy();
    expect(screen.getByText(ZERO_LINE)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert', { name: FAILED })).toBeNull();
  });

  it('still shows a score that has arrived', async () => {
    // WHY: a loaded score stays on the matrix. The unread line must not
    // replace a composite the read already returned.
    apiMock.mockImplementation(
      withShell((path: string) => {
        if (isScore(path)) {
          return Promise.resolve({
            id: '44444444-4444-4444-8444-444444444444',
            opportunityId: OPPORTUNITY_ID,
            criteria: { strategic_fit: 5 },
            totalScore: 14,
            notes: 'Kept the score notes',
            overrideJustification: null,
          });
        }
        return Promise.reject(new Error(`unhandled: ${path}`));
      }),
    );
    window.history.replaceState(null, '', `/bid-matrix?opportunityId=${OPPORTUNITY_ID}`);

    renderPage();

    expect(await screen.findByRole('group', { name: SCORE_READY })).toBeTruthy();
    expect(screen.getByText('1/10 criteria rated.')).toBeTruthy();
    expect(screen.queryByText(NOT_YET)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert', { name: FAILED })).toBeNull();
  });
});
