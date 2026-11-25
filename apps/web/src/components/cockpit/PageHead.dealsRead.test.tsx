// A deal read that has not settled is not an account with no bids. The cockpit
// header must not say "0 open deals" or offer Create opportunity until that
// read succeeds. A failed read is a retry, and a later failure keeps the last
// count.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { AccountCockpitMaybeScored, CrmCompany } from '@bidstack/shared';
import { useOpportunities } from '@/hooks/useOpportunities';
import '@/i18n';

import { PageHead } from './PageHead';

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(),
  useCreateOpportunity: () => ({ mutate: vi.fn(), isPending: false }),
}));

type DealRead = {
  data?: { items: ReturnType<typeof deal>[] };
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

function deal(customer: string) {
  return {
    id: `${customer}-deal`,
    customer,
    name: `${customer} bid`,
    stage: 's1_lead',
    value: 2_500_000,
    dueDate: '2026-09-01',
    closedAt: null,
  };
}

function cockpit(): AccountCockpitMaybeScored {
  return {
    company: {
      id: '11111111-1111-4111-8111-111111111111',
      source: 'external_crm',
      name: 'Globex',
      domain: null,
      logo: null,
      sourceAttribution: [],
    } as unknown as CrmCompany,
    kpis: [],
    technicalStack: [],
    health: { score: 80, band: 'good', counts: {} },
    keyContacts: [],
    recentActivity: [],
    risks: [],
    compliance: [],
    roadmap: [],
  };
}

function renderHead(state: DealRead) {
  vi.mocked(useOpportunities).mockReturnValue(state as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PageHead cockpit={cockpit()} accountView onDrill={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function openPipeline() {
  return screen.getByRole('group', { name: 'Key numbers' });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('account header before the deal read settles', () => {
  it('does not call a loading read an empty account', () => {
    // WHY: the open-pipeline figure is the first number on the cockpit. Zero,
    // and a Create opportunity button, tell someone to open a bid that may
    // already exist.
    renderHead({
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: false,
      isSuccess: false,
      refetch: vi.fn(),
    });

    const keys = openPipeline();
    expect(keys.textContent).not.toContain('0 open deals');
    expect(keys.textContent).not.toContain('1 open deal');
    expect(screen.queryByRole('button', { name: 'Show open bids' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create opportunity' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Generate brief/ })).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading deals for this account' })).toBeTruthy();
    expect(keys.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('offers a retry when the deal read fails instead of saying there are none', () => {
    // WHY: a failed read is not an empty book. Retry repeats the same read.
    const refetch = vi.fn();
    renderHead({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      isSuccess: false,
      refetch,
    });

    const keys = openPipeline();
    expect(keys.textContent).not.toContain('0 open deals');
    expect(screen.queryByRole('button', { name: 'Create opportunity' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show open bids' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load deals for this account");
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.className).toContain('min-h-11');
    expect(retry.className).toContain('focus-visible:ring-2');
    expect(retry.className).toContain('text-[var(--fg-primary)]');
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the last open deals when a later refresh fails', () => {
    // WHY: a failed refresh is not a new empty book, and it must not swap the
    // brief action for Create opportunity.
    renderHead({
      data: { items: [deal('Globex')] },
      isLoading: false,
      isPending: false,
      isError: true,
      isSuccess: false,
      refetch: vi.fn(),
    });

    expect(screen.getByText('1 open deal')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status', { name: 'Loading deals for this account' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create opportunity' })).toBeNull();
    expect(screen.getByRole('button', { name: /Generate brief/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show open bids' })).toBeTruthy();
  });

  it('says there are no open deals only after a successful empty read', () => {
    // WHY: empty is a real result. Create opportunity belongs to that case.
    renderHead({
      data: { items: [] },
      isLoading: false,
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    });

    expect(screen.getByText('0 open deals')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create opportunity' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status', { name: 'Loading deals for this account' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show open bids' })).toBeTruthy();
  });
});
