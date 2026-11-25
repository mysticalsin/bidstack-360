import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CrmCompany, CrmDeal } from '@bidstack/shared';

import {
  formatUnspecifiedAmount,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';

import { AccountsAllSegment } from './AccountsAllSegment';

// Demo OP-2041 is 1,240,000 at 65% with no currency. The All-accounts header
// and the weighted-pipeline tile were still sending that sum through the euro
// converter. The open-deals tile is a count and must stay a count.

const formatMoneyMicros = vi.hoisted(() => vi.fn((value: number) => `EUR-CONVERTED ${value}`));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
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
  useFormatMoney: () => ({ formatMoneyMicros }),
}));
vi.mock('@/hooks/useAutopopulateSalesCompanies', () => ({
  AUTOPOPULATE_MAX: 25,
  useAutopopulateSalesCompanies: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    data: null,
  }),
}));

const dashboardState: { current: unknown } = { current: null };

vi.mock('@/hooks/useCrmDashboard', () => ({
  useCrmDashboard: () => dashboardState.current,
}));
vi.mock('@/hooks/useMsaLeverage', () => ({
  useMsaLeverage: () => ({ isLoading: false, isError: false, data: { items: [], hemaPharmaCount: 0 } }),
}));

const WEIGHTED = formatUnspecifiedAmount(806_000);

function company(): CrmCompany {
  return {
    id: 'co-ci',
    source: 'external_crm',
    name: 'CI Financial',
    legalName: null,
    domain: 'ci.example',
    website: null,
    industry: 'financial_services',
    imageUrl: null,
    employeeCount: 2500,
    annualRevenueMicros: null,
    status: null,
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    logo: null,
    technicalStack: [],
    confidence: 0.87,
    sourceAttribution: [],
    updatedAt: '2026-06-16T12:00:00.000Z',
  } as CrmCompany;
}

function deal(overrides: Partial<CrmDeal> = {}): CrmDeal {
  return {
    id: 'op-2041',
    source: 'external_crm',
    companyId: 'co-ci',
    companyName: 'CI Financial',
    name: 'CI Financial — IT Modernization & MSP',
    stage: 'proposal',
    amountMicros: 1_240_000 * 1_000_000,
    currencyCode: null,
    probability: 65,
    closeDate: '2026-07-22',
    ownerId: null,
    ownerName: null,
    updatedAt: '2026-06-16T12:00:00.000Z',
    ...overrides,
  };
}

function renderSegment() {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AccountsAllSegment />
    </MemoryRouter>,
  );
}

describe('Accounts list pipeline currency', () => {
  afterEach(() => {
    cleanup();
    dashboardState.current = null;
    formatMoneyMicros.mockClear();
  });

  it('does not convert the weighted pipeline of demo OP-2041 into euros', () => {
    // WHY: the header and the weighted-pipeline tile are the book a salesperson
    // reads before the cards. A won bid on the same account is not open pipeline.
    // The open-deals tile is a count, so the missing-currency sentence stays off it.
    dashboardState.current = {
      data: {
        companies: [company()],
        deals: [
          deal(),
          deal({
            id: 'op-won',
            stage: 'closed_won',
            amountMicros: 880_000 * 1_000_000,
            probability: 100,
          }),
        ],
        providerHealth: [],
      },
      isLoading: false,
      isError: false,
      error: null,
    };
    renderSegment();

    expect(formatMoneyMicros).not.toHaveBeenCalled();
    const text = document.body.textContent ?? '';
    expect(text).toContain(WEIGHTED);
    expect(text).toContain(UNSPECIFIED_CURRENCY_BASIS);
    expect(text).not.toMatch(/EUR-CONVERTED|€/);

    const tile = screen.getByText('Weighted pipeline').parentElement;
    expect(tile?.textContent).toContain(WEIGHTED);
    expect(tile?.textContent).toContain(UNSPECIFIED_CURRENCY_BASIS);

    const openDeals = screen.getByText('Open deals').parentElement;
    expect(openDeals?.textContent).toContain('External CRM pipeline');
    expect(openDeals?.textContent).not.toContain(UNSPECIFIED_CURRENCY_BASIS);

    const header = screen.getByRole('heading', { name: 'Accounts' }).parentElement?.parentElement;
    expect(header?.textContent).toContain(`${WEIGHTED} weighted pipeline`);
    expect(header?.textContent).toContain(UNSPECIFIED_CURRENCY_BASIS);
  });
});
