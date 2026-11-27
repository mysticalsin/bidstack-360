import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CrmCompany } from '@bidstack/shared';

import { AccountsAllSegment } from './AccountsAllSegment';

// WHY: All accounts prints a portfolio above the rows. An empty org and a
// search that matches nothing still said "0 companies", "€0 weighted pipeline",
// and "No coverage gaps in the current view." That is a zero book, not an
// empty page. The empty sentence is the message. A page that has a row still
// shows the book.

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

vi.mock('./AccountCard', () => ({
  AccountCard: () => <div data-testid="account-card" />,
}));
vi.mock('@/components/company/SmartCompanyDialog', () => ({
  SmartCompanyDialog: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
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
  AUTOPOPULATE_MAX: 25,
}));
vi.mock('@/hooks/useMsaLeverage', () => ({
  useMsaLeverage: () => ({
    isLoading: false,
    isError: false,
    data: { items: [], hemaPharmaCount: 0 },
  }),
}));

const dashboardState: { current: unknown } = { current: null };
vi.mock('@/hooks/useCrmDashboard', () => ({
  useCrmDashboard: () => dashboardState.current,
}));

function company(name: string): CrmCompany {
  return {
    id: `c-${name}`,
    source: 'external_crm',
    name,
    legalName: null,
    domain: 'acme.example',
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

function setDashboard(names: string[]) {
  dashboardState.current = {
    data: {
      companies: names.map((name) => company(name)),
      deals: [],
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

function expectNoZeroBook() {
  expect(screen.queryByRole('region', { name: 'Account source coverage' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Portfolio cockpit' })).toBeNull();
  expect(screen.queryByText(/weighted pipeline/i)).toBeNull();
  expect(screen.queryByText('No coverage gaps in the current view.')).toBeNull();
  expect(screen.queryByText(/0 companies/)).toBeNull();
}

describe('AccountsAllSegment empty page is not a zero book', () => {
  afterEach(() => cleanup());

  it('does not price an empty org as a zero portfolio', () => {
    setDashboard([]);
    renderSegment();

    expect(screen.getByRole('heading', { name: 'Accounts' })).toBeTruthy();
    expect(screen.getByText('No accounts yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New account' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('No accounts match your filters')).toBeNull();
    expectNoZeroBook();
  });

  it('does not keep a zero book when a search matches nothing', () => {
    setDashboard(['Acme']);
    renderSegment();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz-not-here' } });

    expect(screen.getByText('No accounts match your filters')).toBeTruthy();
    expect(screen.queryByText('No accounts yet')).toBeNull();
    expectNoZeroBook();
  });

  it('still shows the book when a row is on the page', () => {
    setDashboard(['Acme']);
    renderSegment();

    expect(screen.getByRole('region', { name: 'Account source coverage' })).toBeTruthy();
    expect(screen.getByText('Weighted pipeline')).toBeTruthy();
    expect(screen.getByText(/1 company/)).toBeTruthy();
    expect(screen.queryByText('No accounts yet')).toBeNull();
    expect(screen.queryByText('No accounts match your filters')).toBeNull();
  });
});
