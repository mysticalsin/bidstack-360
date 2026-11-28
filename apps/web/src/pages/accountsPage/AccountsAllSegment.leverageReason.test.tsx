import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CrmCompany } from '@bidstack/shared';

import { AccountsAllSegment } from './AccountsAllSegment';

// WHY: Demo Northwind Pharma has an active HEMA MSA and no IT pipeline. The
// dashboard tile sends the reader to this list. Until the card (or the
// outside-snapshot link) says the MSA is in place and whether the scope needs
// an amendment, the account looks like any other empty book. A Siemens card
// with no flag must stay quiet so the sentence is the leverage fact, not a
// banner on every account.

const HEADLINE =
  'MSA in place via HEMA, no IT business yet: use the existing MSA to enter IT';
const AMENDMENT = 'Scope may need amendment before other lines can use this MSA.';
const NORTHWIND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SIEMENS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

vi.mock('@/components/company/SmartCompanyDialog', () => ({
  SmartCompanyDialog: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));
vi.mock('@/components/motion/AnimatedMetric', () => ({
  AnimatedMetric: ({ value }: { value: string }) => <span>{value}</span>,
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
const leverageState: { current: unknown } = { current: null };

vi.mock('@/hooks/useCrmDashboard', () => ({
  useCrmDashboard: () => dashboardState.current,
}));
vi.mock('@/hooks/useMsaLeverage', () => ({
  useMsaLeverage: () => leverageState.current,
}));

function company(id: string, name: string): CrmCompany {
  return {
    id,
    source: 'verified_data',
    name,
    legalName: name,
    domain: `${name.toLowerCase().replace(/\s+/g, '-')}.example`,
    website: null,
    industry: 'Healthcare',
    imageUrl: null,
    employeeCount: 1200,
    annualRevenueMicros: null,
    status: 'active',
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    logo: null,
    technicalStack: [],
    confidence: 0.72,
    sourceAttribution: [],
    updatedAt: '2026-06-01T00:00:00.000Z',
  } as CrmCompany;
}

function flag(companyId: string, companyName: string) {
  return {
    companyId,
    companyName,
    msaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    msaTitle: 'HEMA master services agreement',
    signingEntity: {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      slug: 'hema',
      name: 'HEMA',
      brandFamily: 'amaris',
      businessLines: ['pharma'],
      verificationStatus: 'verified',
    },
    coveredLines: ['pharma'],
    missingLines: ['it', 'engineering', 'digital'],
    headline: HEADLINE,
    scopeAllowsOtherServices: false,
    scopeNeedsAmendment: true,
    scopeCitation: { page: 1, clause: 'Clause 3', excerpt: 'does not include information technology' },
  };
}

function setDashboard(companies: CrmCompany[]) {
  dashboardState.current = {
    data: { companies, deals: [], providerHealth: [] },
    isLoading: false,
    isError: false,
    error: null,
  };
}

function renderSegment(path = '/accounts') {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <AccountsAllSegment />
    </MemoryRouter>,
  );
}

describe('Accounts list HEMA reason', () => {
  afterEach(() => {
    cleanup();
    dashboardState.current = null;
    leverageState.current = null;
  });

  it('prints the MSA headline and the amendment on the account that the flag names', () => {
    setDashboard([company(NORTHWIND, 'Northwind Pharma'), company(SIEMENS, 'Siemens')]);
    leverageState.current = {
      isLoading: false,
      isError: false,
      data: {
        items: [
          flag(NORTHWIND, 'Northwind Pharma'),
          {
            ...flag(NORTHWIND, 'Northwind Pharma'),
            msaId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            headline: 'Second MSA on the same account',
          },
        ],
        hemaPharmaCount: 1,
      },
    };
    renderSegment();

    const northwind = screen.getByRole('link', { name: /Open Northwind Pharma customer cockpit/i });
    expect(northwind.textContent).toContain(HEADLINE);
    expect(northwind.textContent).toContain(AMENDMENT);
    expect(northwind.textContent).toContain('1 more agreement on this account.');
    expect(northwind.getAttribute('aria-label')).toContain(HEADLINE);
    expect(northwind.getAttribute('aria-label')).toContain(AMENDMENT);

    const siemens = screen.getByRole('link', { name: /Open Siemens customer cockpit/i });
    expect(siemens.textContent).not.toContain(HEADLINE);
    expect(siemens.textContent).not.toContain(AMENDMENT);
  });

  it('names the headline on an under-leveraged account that sits outside the snapshot', () => {
    setDashboard([company(SIEMENS, 'Siemens')]);
    leverageState.current = {
      isLoading: false,
      isError: false,
      data: { items: [flag(NORTHWIND, 'Northwind Pharma')], hemaPharmaCount: 1 },
    };
    renderSegment('/accounts?leverage=hema');

    const outside = screen.getByRole('link', { name: /Northwind Pharma/i });
    expect(outside.getAttribute('href')).toBe(`/accounts/${NORTHWIND}`);
    expect(outside.textContent).toContain(HEADLINE);
  });

  it('does not invent a leverage sentence when the read settled with no flags', () => {
    setDashboard([company(SIEMENS, 'Siemens')]);
    leverageState.current = {
      isLoading: false,
      isError: false,
      data: { items: [], hemaPharmaCount: 0 },
    };
    renderSegment();

    expect(screen.queryByText(AMENDMENT)).toBeNull();
    expect(screen.queryByTestId('account-card-leverage')).toBeNull();
  });
});
