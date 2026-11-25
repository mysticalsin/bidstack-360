// The win-rate tile names the closed book. CI Financial has six decided bids
// and one open modernization. "Show won and lost" has to open that closed
// book, not every bid on the account.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { AccountCockpitMaybeScored, CrmCompany } from '@bidstack/shared';

import { PageHead } from './PageHead';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: () => ({ data: { items: [] }, isLoading: false, isError: false }),
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({ formatMoney: (n: number) => String(n) }),
}));

vi.mock('@/components/opportunity/CreateOpportunityDialog', () => ({
  CreateOpportunityDialog: () => null,
}));

vi.mock('@/components/opportunity/BriefingDialog', () => ({
  BriefingDialog: () => null,
}));

function cockpit(): AccountCockpitMaybeScored {
  return {
    company: {
      id: 'ci',
      source: 'verified_data',
      name: 'CI Financial',
      legalName: 'CI Financial Corp.',
      domain: 'ci.example',
      website: null,
      industry: 'financial_services',
      imageUrl: null,
      employeeCount: null,
      annualRevenueMicros: null,
      status: 'active',
      registryIds: {},
      formerNames: [],
      incorporationDate: null,
      logo: null,
      technicalStack: [],
      confidence: 1,
      sourceAttribution: [],
      updatedAt: '2026-11-01T00:00:00.000Z',
    } as CrmCompany,
    kpis: [],
    technicalStack: [],
    health: null,
    keyContacts: [],
    recentActivity: [],
    risks: [],
    compliance: [],
    roadmap: [],
    winLoss: {
      wonCount: 4,
      lostCount: 2,
      wonValueMicros: 0,
      lostValueMicros: 0,
      winRate: 67,
    },
  };
}

afterEach(cleanup);

describe('account header win rate', () => {
  it('asks for the closed book when the lead shows won and lost', () => {
    const onDrill = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PageHead cockpit={cockpit()} accountView onDrill={onDrill} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show won and lost' }));
    expect(onDrill).toHaveBeenCalledTimes(1);
    expect(onDrill).toHaveBeenCalledWith('closed');
  });
});
