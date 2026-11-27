import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CrmCompany, CrmDeal } from '@bidstack/shared';

import { AccountsAllSegment } from './AccountsAllSegment';

// WHY: "Accounts (All)" derives its whole dataset from the /crm/dashboard
// snapshot (dashboard.data.companies) and does 100% client-side search/filter
// over it. That snapshot is server-bounded (opportunities take:100 + company
// enrichments take:200 in dashboard.service.ts) and carries no total — so at a
// large tenant it silently shows only a subset, and a search for a real company
// outside the snapshot renders "No accounts match your filters" as if the record
// were absent. These tests pin the honest interim signal: a visible cap notice
// once the payload is at the server bound, and empty-state copy that tells the
// user search only covers the loaded snapshot. They fail if the view reverts to
// silently presenting the bounded snapshot as the full portfolio — and they also
// guard the inverse: a small org whose snapshot IS complete must NOT be warned.

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? ''));
    },
  }),
}));

vi.mock('framer-motion', () => {
  const passthrough = (Tag: 'div' | 'section' | 'span') => {
    const MotionStub = ({ children, ...props }: { children?: ReactNode }) => {
      const {
        animate,
        exit,
        initial,
        layout,
        transition,
        variants,
        whileHover,
        whileTap,
        ...domProps
      } = props as Record<string, unknown>;
      void animate;
      void exit;
      void initial;
      void layout;
      void transition;
      void variants;
      void whileHover;
      void whileTap;
      return <Tag {...domProps}>{children}</Tag>;
    };
    return MotionStub;
  };
  return {
    motion: {
      div: passthrough('div'),
      section: passthrough('section'),
      span: passthrough('span'),
    },
    useReducedMotion: () => true,
  };
});

// Card + dialog internals are irrelevant to the snapshot-cap contract; stub them
// so the test exercises only the segment's own cap/empty logic.
vi.mock('./AccountCard', () => ({
  AccountCard: () => <div data-testid="account-card" />,
}));
vi.mock('@/components/company/SmartCompanyDialog', () => ({
  SmartCompanyDialog: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));
// Header stat widgets animate via useMotionValue — irrelevant to this contract.
vi.mock('./AccountDashboardWidgets', () => ({
  SourceStat: () => <div data-testid="source-stat" />,
  IntegrationMotionRail: () => <div data-testid="integration-rail" />,
}));
vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({
    currency: 'EUR',
    convert: (v: number) => v,
    formatMoney: (v: number) => `€${v}`,
    formatMoneyMicros: (v: number) => `€${v}`,
  }),
}));
vi.mock('@/hooks/useAutopopulateSalesCompanies', () => ({
  useAutopopulateSalesCompanies: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    data: null,
  }),
}));

// Mutable dashboard state each test overrides before rendering.
const dashboardState: { current: unknown } = { current: null };
vi.mock('@/hooks/useCrmDashboard', () => ({
  useCrmDashboard: () => dashboardState.current,
}));
vi.mock('@/hooks/useMsaLeverage', () => ({
  useMsaLeverage: () => ({ isLoading: false, isError: false, data: { items: [], hemaPharmaCount: 0 } }),
}));

function company(i: number): CrmCompany {
  return {
    id: `c-${i}`,
    source: 'external_crm',
    name: `Acme ${i}`,
    legalName: null,
    domain: null,
    website: null,
    industry: null,
    imageUrl: null,
    employeeCount: null,
    annualRevenueMicros: null,
    status: null,
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    logo: null,
    technicalStack: [],
    confidence: 0.5,
    sourceAttribution: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as CrmCompany;
}

function setDashboard(companyCount: number, deals: CrmDeal[] = []) {
  dashboardState.current = {
    data: {
      companies: Array.from({ length: companyCount }, (_v, i) => company(i)),
      deals,
      providerHealth: [],
    },
    isLoading: false,
    isError: false,
    error: null,
  };
}

function deal(closeDate: string): CrmDeal {
  return {
    id: `deal-${closeDate}`,
    source: 'external_crm',
    companyId: 'c-0',
    companyName: 'Acme 0',
    name: 'Modernization',
    stage: 'proposal',
    amountMicros: 1_240_000_000_000,
    currencyCode: 'EUR',
    probability: 65,
    closeDate,
    ownerId: null,
    ownerName: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderSegment() {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AccountsAllSegment />
    </MemoryRouter>,
  );
}

// 200 = the enrichment take:200 ceiling in dashboard.service.ts — at/above it a
// source is at its cap and more accounts almost certainly exist beyond the
// snapshot, so the view is truncated.
const CAP = 200;

describe('AccountsAllSegment snapshot-cap honesty', () => {
  beforeEach(() => {
    dashboardState.current = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('surfaces a cap notice when the dashboard payload is at the server bound', () => {
    setDashboard(CAP);
    renderSegment();

    expect(
      screen.getByText(/most active 200 accounts from the live dashboard/i),
    ).toBeTruthy();
  });

  it('does not warn when the snapshot is complete (small org) — no false alarm', () => {
    setDashboard(5);
    renderSegment();

    expect(screen.queryByText(/from the live dashboard/i)).toBeNull();
  });

  it('tells the user search only covers the loaded snapshot when a capped search misses', () => {
    setDashboard(CAP);
    renderSegment();

    // Search for something no loaded company matches → the client-side filter
    // empties the view. The record could still exist outside the snapshot.
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'zzz-not-in-snapshot' },
    });

    expect(screen.getByText('No accounts match your filters')).toBeTruthy();
    expect(
      screen.getByText(/searches only the accounts loaded from your live dashboard/i),
    ).toBeTruthy();
  });

  it('keeps the plain empty copy for a small org so misses are not falsely blamed on a cap', () => {
    setDashboard(5);
    renderSegment();

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'zzz-not-in-snapshot' },
    });

    expect(screen.getByText('No accounts match your filters')).toBeTruthy();
    expect(
      screen.queryByText(/searches only the accounts loaded from your live dashboard/i),
    ).toBeNull();
  });

  // A brand-new production org has zero companies and no filters applied — the
  // dashboard endpoint still returns a (valid, empty) snapshot, not an error.
  // That must read as a first-run empty state with a create CTA, not the
  // filter-miss copy (which implies accounts exist but none matched).
  it('shows a first-run empty state (not the filter-miss copy) when the org truly has zero accounts', () => {
    setDashboard(0);
    renderSegment();

    expect(screen.getByText('No accounts yet')).toBeTruthy();
    expect(screen.queryByText('No accounts match your filters')).toBeNull();
    expect(
      screen.getByRole('link', { name: /import accounts from csv/i }),
    ).toBeTruthy();
  });
});

describe('AccountsAllSegment past close', () => {
  beforeEach(() => {
    dashboardState.current = null;
  });

  afterEach(() => {
    cleanup();
  });

  // WHY: the cards are mocked here. The list header and the open-deals tile
  // are the portfolio totals a salesperson reads before the cards. On the demo
  // book every open bid is already past its close day, and those two lines
  // still read as a live book. A close date years ahead must stay quiet.
  it('says how many open deals in the loaded view are already past close', () => {
    setDashboard(1, [deal('2020-01-01')]);
    renderSegment();

    expect(screen.getAllByText('1 past close')).toHaveLength(2);
  });

  it('stays quiet when every open deal closes on a later day', () => {
    setDashboard(1, [deal('2099-01-01')]);
    renderSegment();

    expect(screen.queryByText(/past close/i)).toBeNull();
    expect(screen.getByText('External CRM pipeline')).toBeTruthy();
  });
});
