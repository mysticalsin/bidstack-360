// The open-pipeline figure sits in the account header. A won bid with an old
// due date must not join that count, and an open bid from 2020 must say how
// many days late it is. The line is the header, not a helper sitting unused.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { AccountCockpitMaybeScored, CrmCompany } from '@bidstack/shared';

import { openBookDue } from './account-open-due';
import { PageHead } from './PageHead';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(vars[k] ?? '')) : fallback,
  }),
}));

const opps = vi.hoisted(() => ({
  items: [] as Array<{
    id: string;
    customer: string;
    name: string;
    stage: string;
    value: number;
    dueDate: string | null;
    closedAt: string | null;
  }>,
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: () => ({ data: { items: opps.items }, isLoading: false, isError: false }),
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

function company(): CrmCompany {
  return {
    id: '8d1c2d4f-09de-4c14-8f98-731e01bc36c9',
    source: 'verified_data',
    name: 'Acme North',
    legalName: 'Acme North SAS',
    domain: 'acme.example',
    website: 'https://acme.example/',
    industry: 'Technology',
    imageUrl: null,
    employeeCount: 500,
    annualRevenueMicros: null,
    status: 'active',
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    logo: null,
    technicalStack: [],
    confidence: 0.9,
    sourceAttribution: [],
    updatedAt: '2026-06-16T12:00:00.000Z',
  };
}

function cockpit(): AccountCockpitMaybeScored {
  return {
    company: company(),
    externalLastSyncedAt: null,
    kpis: [],
    revenueEvolution: [],
    winLoss: { wonCount: 1, lostCount: 0, wonValueMicros: 0, lostValueMicros: 0, winRate: 100 },
    technicalStack: [],
    health: { score: 80, band: 'good', counts: {}, factors: [] },
    keyContacts: [],
    recentActivity: [],
    risks: [],
    compliance: [],
    roadmap: [],
  };
}

function renderHead() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/accounts/acct-1']}>
        <Routes>
          <Route
            path="/accounts/:accountId"
            element={<PageHead cockpit={cockpit()} accountView onDrill={() => undefined} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  opps.items = [];
});

describe('account header open pipeline', () => {
  it('says how many days an open bid is already late, and leaves the won bid off that clock', () => {
    opps.items = [
      {
        id: 'open-1',
        customer: 'Acme North',
        name: 'IT modernization',
        stage: 's3_technical_iteration',
        value: 1_240_000,
        dueDate: '2020-01-15',
        closedAt: null,
      },
      {
        id: 'won-1',
        customer: 'Acme North',
        name: 'Endpoint refresh',
        stage: 'closed_won',
        value: 410_000,
        dueDate: '2019-04-28',
        closedAt: '2019-04-28',
      },
    ];
    const book = openBookDue(opps.items, new Date());
    renderHead();
    const line = screen.getByText(/1 open deal/);
    expect(line.textContent).toBe(`1 open deal · ${book.oldestOverdueDays}d overdue`);
    expect(book.overdue).toBe(1);
    expect(book.open).toBe(1);
  });

  it('does not call a bid due today overdue', () => {
    const today = new Date().toISOString().slice(0, 10);
    opps.items = [
      {
        id: 'today-1',
        customer: 'Acme North',
        name: 'Due today',
        stage: 's2_sent',
        value: 10,
        dueDate: today,
        closedAt: null,
      },
    ];
    renderHead();
    expect(screen.getByText('1 open deal').textContent).toBe('1 open deal');
    expect(screen.queryByText(/overdue/)).toBeNull();
  });
});
