import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

function openDeal(companyId: string, amountMicros: number): CrmDeal {
  return {
    id: `deal-${companyId}`,
    source: 'external_crm',
    companyId,
    companyName: null,
    name: 'Open bid',
    stage: 'proposal',
    amountMicros,
    currencyCode: 'EUR',
    probability: 100,
    closeDate: null,
    ownerId: null,
    ownerName: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
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

// Health bands on the portfolio cockpit (Strong / Good / Watch / At risk).
// Pipeline micros at probability 100: 0 → At risk, 100k → Watch,
// 500k → Good, 3M → Strong. See deriveAccount.
const WATCH_MICROS = 100_000_000_000;
const GOOD_MICROS = 500_000_000_000;
const STRONG_MICROS = 3_000_000_000_000;

function setHealthPortfolio() {
  setDashboard(4, [
    openDeal('c-1', WATCH_MICROS),
    openDeal('c-2', GOOD_MICROS),
    openDeal('c-3', STRONG_MICROS),
  ]);
}

describe('AccountsAllSegment health bands', () => {
  // WHY: those four counts are the way a salesperson picks who to work.
  // They sit in the same summary as the segment controls, which do filter.
  // If a band is only a painted bar, pressing it leaves the full portfolio
  // on screen. The other bands must keep their counts so the next band is
  // one press, not a reset followed by a guess.
  beforeEach(() => {
    dashboardState.current = null;
  });

  afterEach(() => {
    cleanup();
  });

  function healthGroup() {
    // Scoped so "Watch" here is the health band, not the segment button of the same name.
    return within(screen.getByRole('group', { name: 'Account health' }));
  }

  it('narrows the account cards to the health band that was pressed', () => {
    setHealthPortfolio();
    renderSegment();

    expect(screen.getAllByTestId('account-card')).toHaveLength(4);

    fireEvent.click(healthGroup().getByRole('button', { name: /^Strong\b/ }));

    expect(screen.getAllByTestId('account-card')).toHaveLength(1);
    expect(healthGroup().getByRole('button', { name: /^Strong\b/ }).getAttribute('aria-pressed')).toBe('true');
    expect(healthGroup().getByRole('button', { name: /^Good\b/ }).textContent).toMatch(/1/);
    expect(healthGroup().getByRole('button', { name: /^Watch\b/ }).textContent).toMatch(/1/);
    expect(healthGroup().getByRole('button', { name: /^At risk\b/ }).textContent).toMatch(/1/);

    fireEvent.click(healthGroup().getByRole('button', { name: /^Good\b/ }));

    expect(screen.getAllByTestId('account-card')).toHaveLength(1);
    expect(healthGroup().getByRole('button', { name: /^Good\b/ }).getAttribute('aria-pressed')).toBe('true');
    expect(healthGroup().getByRole('button', { name: /^Strong\b/ }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(healthGroup().getByRole('button', { name: /^Good\b/ }));

    expect(screen.getAllByTestId('account-card')).toHaveLength(4);
    expect(healthGroup().getByRole('button', { name: /^Good\b/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('clears the health band from Reset with the other filters', () => {
    setHealthPortfolio();
    renderSegment();

    fireEvent.click(healthGroup().getByRole('button', { name: /^At risk\b/ }));
    expect(screen.getAllByTestId('account-card')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getAllByTestId('account-card')).toHaveLength(4);
    expect(healthGroup().getByRole('button', { name: /^At risk\b/ }).getAttribute('aria-pressed')).toBe('false');
  });
});
