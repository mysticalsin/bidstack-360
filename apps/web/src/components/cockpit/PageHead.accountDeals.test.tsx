import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { AccountCockpitMaybeScored, CrmCompany } from '@bidstack/shared';
import { useOpportunities } from '@/hooks/useOpportunities';
import '@/i18n';

import { PageHead } from './PageHead';

const GLOBEX = '11111111-1111-4111-8111-111111111111';

vi.mock('@/hooks/useOpportunities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOpportunities')>();
  return { ...actual, useOpportunities: vi.fn() };
});

function cockpit(name: string): AccountCockpitMaybeScored {
  return {
    company: {
      id: 'name-only',
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

function deal(customer: string) {
  return {
    id: `${customer}-deal`,
    customer,
    name: `${customer} bid`,
    stage: 's1_lead',
    value: 1000,
    dueDate: null,
    closedAt: null,
  };
}

function renderHead(accountId: string, items: ReturnType<typeof deal>[]) {
  vi.mocked(useOpportunities).mockReturnValue({
    data: { items },
    isLoading: false,
  } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/accounts/${accountId}`]}>
        <Routes>
          <Route
            path="/accounts/:accountId"
            element={<PageHead cockpit={cockpit('Globex')} accountView />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PageHead account deal counts', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('counts deals linked by company id even when the customer text differs', () => {
    // WHY: the key number used the first 50 deals in the portfolio and kept
    // an exact customer-name match. Globex Labs is a different customer string
    // and a later Globex deal never reached the page, so the open-pipeline
    // figure on the cockpit was not this account.
    renderHead(GLOBEX, [deal('Globex Labs'), deal('Initech')]);
    expect(vi.mocked(useOpportunities).mock.calls.at(-1)?.[0]).toEqual({
      limit: 50,
      companyId: GLOBEX,
    });
    expect(screen.getByText('2 open deals')).toBeTruthy();
  });

  it('keeps the name match when the route is not a company id', () => {
    renderHead('globex', [deal('Globex'), deal('Globex Labs')]);
    expect(vi.mocked(useOpportunities).mock.calls.at(-1)?.[0]).toEqual({ limit: 50 });
    expect(screen.getByText('1 open deal')).toBeTruthy();
  });
});
