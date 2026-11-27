import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BidFact } from '@/hooks/agent/useBidFacts';

import { AgentRationaleList } from './AgentRationaleList';

// An unread ledger has no payload. isLoading is false for a paused read and
// for an in-flight read that has not resolved. Neither is an empty ledger.
const hookMocks = vi.hoisted(() => ({
  client: null as QueryClient | null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

function fact(overrides: Partial<BidFact> = {}): BidFact {
  return {
    id: 'f1',
    opportunityId: 'o1',
    subjectType: 'matrix_row',
    subjectId: 'r1',
    claim: 'Northwind keeps EU data in Dublin',
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

function seedLedger(state: {
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'paused' | 'fetching' | 'idle';
  data: unknown;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const query = client.getQueryCache().build(client, {
    queryKey: ['bid-facts', 'matrix_row', 'row-1', 'PROPOSED'],
    queryFn: () => new Promise(() => undefined),
    enabled: false,
  });
  query.setState({
    status: state.status,
    fetchStatus: state.fetchStatus,
    data: state.data,
    error: state.status === 'error' ? new Error('boom') : null,
  });
  hookMocks.client = client;
  return client;
}

function renderLedger(facts: readonly BidFact[]) {
  const client = hookMocks.client ?? new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <AgentRationaleList facts={facts} isLoading={false} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  hookMocks.client?.clear();
  hookMocks.client = null;
});

describe('agent ledger read', () => {
  it('does not paint a paused read as an empty ledger', () => {
    seedLedger({ status: 'pending', fetchStatus: 'paused', data: undefined });
    renderLedger([]);
    expect(screen.getByText('Checking what the agent did')).toBeTruthy();
    expect(screen.queryByText('The agent has not proposed anything on this bid yet.')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('does not paint an in-flight read as an empty ledger', () => {
    seedLedger({ status: 'pending', fetchStatus: 'fetching', data: undefined });
    renderLedger([]);
    expect(screen.getByText('Checking what the agent did')).toBeTruthy();
    expect(screen.queryByText('The agent has not proposed anything on this bid yet.')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('keeps a failed read on the error', () => {
    seedLedger({ status: 'error', fetchStatus: 'idle', data: undefined });
    renderLedger([]);
    expect(screen.getByText('Could not load what the agent did')).toBeTruthy();
    expect(screen.queryByText('The agent has not proposed anything on this bid yet.')).toBeNull();
    expect(screen.queryByText('Checking what the agent did')).toBeNull();
  });

  it('keeps a failed read with a stale proposal on the error', () => {
    seedLedger({
      status: 'error',
      fetchStatus: 'idle',
      data: { items: [fact({ claim: 'Northwind keeps EU data in Dublin' })], total: 1 },
    });
    renderLedger([fact({ claim: 'Northwind keeps EU data in Dublin' })]);
    expect(screen.getByText('Could not load what the agent did')).toBeTruthy();
    expect(screen.queryByText('Northwind keeps EU data in Dublin')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('keeps a settled empty ledger honestly empty', () => {
    seedLedger({
      status: 'success',
      fetchStatus: 'idle',
      data: { items: [], total: 0 },
    });
    renderLedger([]);
    expect(screen.getByText('The agent has not proposed anything on this bid yet.')).toBeTruthy();
    expect(screen.queryByText('Checking what the agent did')).toBeNull();
    expect(screen.queryByText('Could not load what the agent did')).toBeNull();
  });

  it('keeps a settled null payload honestly empty', () => {
    seedLedger({ status: 'success', fetchStatus: 'idle', data: null });
    renderLedger([]);
    expect(screen.getByText('The agent has not proposed anything on this bid yet.')).toBeTruthy();
    expect(screen.queryByText('Checking what the agent did')).toBeNull();
    expect(screen.queryByText('Could not load what the agent did')).toBeNull();
  });

  it('keeps a loaded proposal, including a blank claim and a zero score', () => {
    const loaded = fact({ claim: '', confidenceBps: 0, rationale: null });
    seedLedger({
      status: 'success',
      fetchStatus: 'idle',
      data: { items: [loaded], total: 1 },
    });
    renderLedger([loaded]);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('Proposed')).toBeTruthy();
    expect(screen.queryByText('The agent has not proposed anything on this bid yet.')).toBeNull();
    expect(screen.queryByText('Checking what the agent did')).toBeNull();
  });

  it('keeps a loaded proposal whose claim is the digit zero', () => {
    const loaded = fact({ claim: '0', confidenceBps: 0 });
    seedLedger({
      status: 'success',
      fetchStatus: 'idle',
      data: { items: [loaded], total: 1 },
    });
    renderLedger([loaded]);
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByText('The agent has not proposed anything on this bid yet.')).toBeNull();
  });
});
