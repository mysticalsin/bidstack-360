import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountCockpitMaybeScored } from '@bidstack/shared';

import { PageHead } from './PageHead';

// An unread list has no payload. isLoading is false for a paused read and
// for an in-flight read that has not resolved. Neither is a settled zero.
type Opp = {
  id: string;
  name: string;
  customer: string;
  value: number;
  stage: string;
  dueDate: string | null;
  closedAt: string | null;
};

const hookMocks = vi.hoisted(() => ({
  opps: {
    data: undefined as { items: Opp[] } | null | undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback ?? key;
      return String(fallback).replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(values[name] ?? ''),
      );
    },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ accountId: 'northwind' }) };
});

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: () => hookMocks.opps,
  useCreateOpportunity: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useEnrichCompany', () => ({
  useEnrichCompany: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({
    formatMoney: (value: number) => `EUR ${value}`,
  }),
}));

function deal(overrides: Partial<Opp> = {}): Opp {
  return {
    id: 'opp-1',
    name: 'Northwind renewal',
    customer: 'Northwind',
    value: 0,
    stage: 's1_lead',
    dueDate: null,
    closedAt: null,
    ...overrides,
  };
}

function cockpit(): AccountCockpitMaybeScored {
  return {
    company: {
      id: 'co-northwind',
      name: 'Northwind',
      industry: '',
      domain: 'northwind.example',
      logo: null,
      confidence: 0.5,
      updatedAt: '2026-06-16T12:00:00.000Z',
      employeeCount: 0,
      legalName: 'Northwind',
      website: null,
      imageUrl: null,
      incorporationDate: null,
      strategicIntel: null,
      sourceAttribution: [],
    },
    health: { band: 'good', score: 70, counts: {} },
    risks: [],
    compliance: [],
    keyContacts: [],
    winLoss: undefined,
  } as AccountCockpitMaybeScored;
}

function renderHead() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PageHead cockpit={cockpit()} accountView />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('account header opportunity link', () => {
  it('does not paint a paused read as zero open deals', () => {
    hookMocks.opps = { data: undefined, isLoading: false, isFetching: false, isError: false };
    renderHead();
    expect(screen.getByText('Checking linked opportunities')).toBeTruthy();
    expect(screen.queryByText('0 open deals')).toBeNull();
    expect(screen.queryByText('EUR 0')).toBeNull();
    expect(screen.queryByRole('button', { name: /Create opportunity/ })).toBeNull();
  });

  it('does not paint an in-flight read as zero open deals', () => {
    hookMocks.opps = { data: undefined, isLoading: false, isFetching: true, isError: false };
    renderHead();
    expect(screen.getByText('Checking linked opportunities')).toBeTruthy();
    expect(screen.queryByText('0 open deals')).toBeNull();
    expect(screen.queryByRole('button', { name: /Create opportunity/ })).toBeNull();
  });

  it('keeps a failed read on the error and drops a stale deal', () => {
    hookMocks.opps = {
      data: { items: [deal({ value: 12 })] },
      isLoading: false,
      isFetching: false,
      isError: true,
    };
    renderHead();
    expect(screen.getByText('Could not check linked opportunities')).toBeTruthy();
    expect(screen.queryByText('Northwind renewal')).toBeNull();
    expect(screen.queryByText('EUR 12')).toBeNull();
    expect(screen.queryByText('1 open deal')).toBeNull();
    expect(screen.queryByRole('button', { name: /Generate brief/ })).toBeNull();
  });

  it('keeps a failed read with no payload on the error', () => {
    hookMocks.opps = { data: undefined, isLoading: false, isFetching: false, isError: true };
    renderHead();
    expect(screen.getByText('Could not check linked opportunities')).toBeTruthy();
    expect(screen.queryByText('0 open deals')).toBeNull();
    expect(screen.queryByRole('button', { name: /Create opportunity/ })).toBeNull();
  });

  it('keeps a settled empty list honestly empty', () => {
    hookMocks.opps = {
      data: { items: [] },
      isLoading: false,
      isFetching: false,
      isError: false,
    };
    renderHead();
    expect(screen.getAllByText('0 open deals').length).toBeGreaterThan(0);
    expect(screen.getAllByText('EUR 0').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Create opportunity/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Checking linked opportunities')).toBeNull();
  });

  it('keeps a settled null payload honestly empty', () => {
    hookMocks.opps = { data: null, isLoading: false, isFetching: false, isError: false };
    renderHead();
    expect(screen.getAllByText('0 open deals').length).toBeGreaterThan(0);
    expect(screen.queryByText('Checking linked opportunities')).toBeNull();
  });

  it('keeps a loaded deal, including a legitimate zero value', () => {
    hookMocks.opps = {
      data: { items: [deal({ value: 0 })] },
      isLoading: false,
      isFetching: false,
      isError: false,
    };
    renderHead();
    expect(screen.getAllByText('1 open deal').length).toBeGreaterThan(0);
    expect(screen.getAllByText('EUR 0').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Generate brief/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { name: 'Northwind' }).length).toBeGreaterThan(0);
  });

  it('keeps a loaded deal when the deal name is blank', () => {
    hookMocks.opps = {
      data: { items: [deal({ name: '' })] },
      isLoading: false,
      isFetching: false,
      isError: false,
    };
    renderHead();
    expect(screen.getAllByRole('button', { name: /Generate brief/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Create opportunity/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Northwind' })).toBeTruthy();
  });
});
