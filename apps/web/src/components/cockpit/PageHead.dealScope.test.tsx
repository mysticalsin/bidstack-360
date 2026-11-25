// The open-pipeline number is the first figure on the account cockpit. It has
// to be this company's bids. A legal name is still this account. A sibling
// name is not, when the cockpit has no company uuid.
import { cleanup, render, screen } from '@testing-library/react';
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

const GLOBEX = '11111111-1111-4111-8111-111111111111';

function deal(customer: string) {
  return {
    id: `${customer}-deal`,
    customer,
    name: `${customer} bid`,
    code: 'OP-1',
    stage: 's2_sent',
    value: 2_500_000,
    dueDate: '2026-09-01',
    closedAt: null,
  };
}

function cockpit(id: string, name: string): AccountCockpitMaybeScored {
  return {
    company: {
      id,
      source: 'external_crm',
      name,
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

function renderHead(id: string, name: string, items: ReturnType<typeof deal>[]) {
  vi.mocked(useOpportunities).mockReturnValue({
    data: { items },
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PageHead cockpit={cockpit(id, name)} accountView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('account header deal scope', () => {
  it('counts a bid whose customer text differs once the company id scoped the read', () => {
    // WHY: the header read the latest 50 bids in the portfolio and kept an
    // exact customer name. A bid stored under the legal name looked like an
    // account with nothing open, and Create opportunity replaced the brief.
    renderHead(GLOBEX, 'Globex', [deal('Globex Labs')]);

    const filters = vi.mocked(useOpportunities).mock.calls.map((call) => call[0]);
    expect(filters.length).toBeGreaterThan(0);
    expect(filters.every((filter) => filter?.companyId === GLOBEX && filter.limit === 50)).toBe(true);
    expect(JSON.stringify(filters)).not.toContain('search');
    expect(JSON.stringify(filters)).not.toContain('Globex');
    expect(screen.getByText('1 open deal')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create opportunity' })).toBeNull();
    expect(screen.getByRole('button', { name: /Generate brief/ })).toBeTruthy();
  });

  it('keeps an exact customer match and drops a sibling when there is no company uuid', () => {
    // WHY: a name-keyed cockpit cannot ask the deals API for a company id.
    // Exact text stays. Globex Labs is a different account.
    renderHead('globex', 'Globex', [deal('Globex'), deal('Globex Labs')]);

    const filters = vi.mocked(useOpportunities).mock.calls.map((call) => call[0]);
    expect(filters.every((filter) => filter?.companyId === undefined && filter?.limit === 50)).toBe(true);
    expect(screen.getByText('1 open deal')).toBeTruthy();
    expect(screen.queryByText('2 open deals')).toBeNull();
  });
});
