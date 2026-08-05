// The adapter over the BidFact ledger. Three behaviours are load-bearing:
//
//   1. the fan-out asks for APPLIED only where a row already has an answer,
//      because that is what bounds a 25-row screen to ≤50 requests;
//   2. an accept collapses the strip under the click (optimistic) — and puts it
//      BACK if the server refuses (it can 409 on a human edit);
//   3. a settled decide invalidates the whole subject, not just the list it
//      patched, so the answer can re-render with its receipt.

import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import {
  bidFactsKey,
  useDecideBidFact,
  useSubjectBidFacts,
  type BidFact,
} from './useBidFacts';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));

function fact(overrides: Partial<BidFact> = {}): BidFact {
  return {
    id: 'fact-1',
    opportunityId: 'ws-1',
    subjectType: 'matrix_row',
    subjectId: 'row-1',
    claim: 'YES — EU datacentres only',
    verdict: 'YES',
    confidenceBps: 9000,
    band: 'VERIFIED',
    assessmentStatus: 'ASSESSED',
    rationale: 'The bid library states this directly',
    status: 'PROPOSED',
    producedByAgentKey: 'compliance-fill',
    decidedByUserId: null,
    decidedAt: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    citations: [],
    ...overrides,
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const urlsCalled = () => vi.mocked(api).mock.calls.map((call) => String(call[0]));

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockResolvedValue({ items: [], total: 0 });
});

describe('useSubjectBidFacts', () => {
  it('asks for APPLIED only on rows that already carry an answer', async () => {
    const queryClient = makeClient();
    renderHook(
      () =>
        useSubjectBidFacts('matrix_row', [
          { subjectId: 'row-1', wantApplied: true },
          { subjectId: 'row-2', wantApplied: false },
        ]),
      { wrapper: makeWrapper(queryClient) },
    );

    await waitFor(() => expect(api).toHaveBeenCalledTimes(3));
    const urls = urlsCalled();
    expect(urls.filter((url) => url.includes('subjectId=row-1'))).toHaveLength(2);
    expect(urls.filter((url) => url.includes('subjectId=row-2'))).toHaveLength(1);
    expect(urls.some((url) => url.includes('subjectId=row-2') && url.includes('APPLIED'))).toBe(
      false,
    );
  });

  it('buckets each subject into proposed / applied and sorts the flat list newest first', async () => {
    const queryClient = makeClient();
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.includes('status=APPLIED')) {
        return {
          items: [fact({ id: 'old', status: 'APPLIED', createdAt: '2026-07-01T09:00:00.000Z' })],
          total: 1,
        };
      }
      return { items: [fact({ id: 'new', createdAt: '2026-08-02T09:00:00.000Z' })], total: 1 };
    });

    const { result } = renderHook(
      () => useSubjectBidFacts('matrix_row', [{ subjectId: 'row-1', wantApplied: true }]),
      { wrapper: makeWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.all).toHaveLength(2));
    expect(result.current.bySubject.get('row-1')?.proposed.map((f) => f.id)).toEqual(['new']);
    expect(result.current.bySubject.get('row-1')?.applied.map((f) => f.id)).toEqual(['old']);
    expect(result.current.all.map((f) => f.id)).toEqual(['new', 'old']);
  });
});

describe('useDecideBidFact', () => {
  it('collapses the strip optimistically and posts the decision', async () => {
    const queryClient = makeClient();
    queryClient.setQueryData(bidFactsKey('matrix_row', 'row-1', 'PROPOSED'), {
      items: [fact({ id: 'fact-9' })],
      total: 1,
    });
    vi.mocked(api).mockResolvedValue({ id: 'fact-9', status: 'APPLIED' });

    const { result } = renderHook(
      () => useDecideBidFact({ subjectType: 'matrix_row', workspaceId: 'ws-1' }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.mutateAsync({
        factId: 'fact-9',
        decision: 'accept',
        subjectId: 'row-1',
      });
    });

    expect(api).toHaveBeenCalledWith('/api/v1/bid-facts/fact-9/decide', {
      method: 'POST',
      body: { decision: 'accept' },
    });
    const cached = queryClient.getQueryData<{ items: BidFact[] }>(
      bidFactsKey('matrix_row', 'row-1', 'PROPOSED'),
    );
    expect(cached?.items).toHaveLength(0);
  });

  it('puts the proposal back when the server refuses the decide', async () => {
    const queryClient = makeClient();
    queryClient.setQueryData(bidFactsKey('matrix_row', 'row-1', 'PROPOSED'), {
      items: [fact({ id: 'fact-9' })],
      total: 1,
    });
    vi.mocked(api).mockRejectedValue(new Error('edited by a person'));

    const { result } = renderHook(
      () => useDecideBidFact({ subjectType: 'matrix_row', workspaceId: 'ws-1' }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current
        .mutateAsync({ factId: 'fact-9', decision: 'accept', subjectId: 'row-1' })
        .catch(() => undefined);
    });

    const cached = queryClient.getQueryData<{ items: BidFact[] }>(
      bidFactsKey('matrix_row', 'row-1', 'PROPOSED'),
    );
    expect(cached?.items.map((item) => item.id)).toEqual(['fact-9']);
  });

  it('invalidates every status for the subject plus the compliance matrix', async () => {
    const queryClient = makeClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(api).mockResolvedValue({ id: 'fact-9', status: 'DISMISSED' });

    const { result } = renderHook(
      () => useDecideBidFact({ subjectType: 'matrix_row', workspaceId: 'ws-1' }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.mutateAsync({
        factId: 'fact-9',
        decision: 'dismiss',
        subjectId: 'row-1',
      });
    });

    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    // No status segment => every status for the subject is cleared.
    expect(keys).toContain(JSON.stringify(['bid-facts', 'matrix_row', 'row-1']));
    expect(keys).toContain(JSON.stringify(['rfp', 'ws-1', 'compliance']));
  });
});
