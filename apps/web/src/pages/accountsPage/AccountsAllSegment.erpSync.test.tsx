import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CrmCompany } from '@bidstack/shared';

import { AccountsAllSegment } from './AccountsAllSegment';

// WHY: demo synthetic accounts are not ERP customers. With ERP left unset, the
// header must not keep a previous enriched/cached line, and Sync must not
// start a pull or toast that an ERP sync failed.

const sync = vi.hoisted(() => ({
  mutate: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  erpSync: 'unset' as 'unset' | 'ready',
  data: { enriched: 4, cached: 2 } as { enriched: number; cached: number } | null,
  companyCount: 1,
}));

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
    motion: { div: passthrough('div'), section: passthrough('section'), span: passthrough('span') },
    useReducedMotion: () => true,
  };
});

vi.mock('./AccountCard', () => ({ AccountCard: () => <div data-testid="account-card" /> }));
vi.mock('@/components/company/SmartCompanyDialog', () => ({
  SmartCompanyDialog: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));
vi.mock('./AccountDashboardWidgets', () => ({
  SourceStat: () => null,
  IntegrationMotionRail: () => null,
}));
vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({ formatMoneyMicros: (value: number) => `€${value}` }),
}));
vi.mock('@/hooks/useMsaLeverage', () => ({
  useMsaLeverage: () => ({ isLoading: false, isError: false, data: { items: [] } }),
}));
vi.mock('@/components/ui/Toast', () => ({
  toast: { info: sync.info, error: sync.error, success: vi.fn() },
}));
vi.mock('@/hooks/useAutopopulateSalesCompanies', () => ({
  AUTOPOPULATE_MAX: 12,
  useAutopopulateSalesCompanies: () => ({
    mutate: sync.mutate,
    isPending: false,
    isError: false,
    error: null,
    data: sync.data,
    erpSync: sync.erpSync,
  }),
}));
vi.mock('@/hooks/useCrmDashboard', () => ({
  useCrmDashboard: () => ({
    data: {
      companies: Array.from({ length: sync.companyCount }, () => ({
          id: 'c-1',
          source: 'external_crm',
          name: 'Northwind Synthetic',
          legalName: null,
          domain: 'northwind.example',
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
        } as CrmCompany)),
      deals: [],
      providerHealth: [],
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

function renderSegment() {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AccountsAllSegment />
    </MemoryRouter>,
  );
}

describe('Accounts list ERP sync under an unset ERP', () => {
  afterEach(() => {
    cleanup();
    sync.mutate.mockReset();
    sync.info.mockReset();
    sync.error.mockReset();
    sync.erpSync = 'unset';
    sync.data = { enriched: 4, cached: 2 };
    sync.companyCount = 1;
  });

  it('does not keep a stale pull count or start a sync when ERP is unset', () => {
    renderSegment();

    expect(screen.queryByText(/enriched/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ERP not connected' }));

    expect(sync.mutate).not.toHaveBeenCalled();
    expect(sync.error).not.toHaveBeenCalled();
    expect(sync.info).toHaveBeenCalledWith(
      'ERP is not connected',
      expect.objectContaining({
        description: expect.stringMatching(/were not pulled/),
      }),
    );
  });

  it('does not tell an empty workspace to sync ERP customers', () => {
    sync.companyCount = 0;
    sync.data = null;
    renderSegment();

    expect(screen.getByText(/no ERP customers to pull/)).toBeTruthy();
    expect(screen.queryByText(/sync top ERP customers/i)).toBeNull();
  });

  it('still shows the pull count and syncs when ERP is connected', () => {
    sync.erpSync = 'ready';
    renderSegment();

    expect(screen.getByText('4 enriched / 2 cached')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sync ERP accounts' }));
    expect(sync.mutate).toHaveBeenCalled();
  });
});
