import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CrmCompany } from '@bidstack/shared';

import { AccountsAllSegment } from './AccountsAllSegment';

// WHY: /accounts?leverage=hema is how the dashboard tile opens this list. The
// account cards come from the dashboard snapshot, which is already here. The
// HEMA ids come from a second read. Treating "that read has not settled" as
// "no accounts match" tells a rep the book is empty while the names are loaded.

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
    motion: { div: passthrough('div'), section: passthrough('section'), span: passthrough('span') },
    useReducedMotion: () => true,
  };
});

vi.mock('./AccountCard', () => ({
  AccountCard: () => <div data-testid="account-card" />,
}));
vi.mock('@/components/company/SmartCompanyDialog', () => ({
  SmartCompanyDialog: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));
vi.mock('./AccountDashboardWidgets', () => ({
  SourceStat: () => null,
  IntegrationMotionRail: () => null,
}));
vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({
    formatMoneyMicros: (v: number) => `€${v}`,
  }),
}));
vi.mock('@/hooks/useAutopopulateSalesCompanies', () => ({
  AUTOPOPULATE_MAX: 50,
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

const leverageState: {
  current: {
    isLoading: boolean;
    isError: boolean;
    data?: { items: Array<{ companyId: string; companyName: string }>; hemaPharmaCount: number };
    refetch: ReturnType<typeof vi.fn>;
  };
} = {
  current: { isLoading: false, isError: false, data: { items: [], hemaPharmaCount: 0 }, refetch: vi.fn() },
};
vi.mock('@/hooks/useMsaLeverage', () => ({
  useMsaLeverage: () => leverageState.current,
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

function renderFiltered() {
  return render(
    <MemoryRouter
      initialEntries={['/accounts?leverage=hema']}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <AccountsAllSegment />
    </MemoryRouter>,
  );
}

describe('Accounts list HEMA filter waits for the leverage read', () => {
  beforeEach(() => {
    dashboardState.current = {
      data: { companies: [company(0), company(1)], deals: [], providerHealth: [] },
      isLoading: false,
      isError: false,
      error: null,
    };
    leverageState.current = {
      isLoading: false,
      isError: false,
      data: { items: [], hemaPharmaCount: 0 },
      refetch: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('does not say the filter matched nothing while the leverage list is still loading', () => {
    leverageState.current = { isLoading: true, isError: false, data: undefined, refetch: vi.fn() };
    renderFiltered();

    const text = document.body.textContent ?? '';
    expect(text).toContain('Loading under-leveraged accounts');
    expect(text).not.toContain('No accounts match your filters');
    expect(text).not.toContain('0 companies');
    expect(text).not.toContain('0 accounts in view');
    expect(text).not.toContain('No coverage gaps in the current view.');
    expect(screen.queryByTestId('account-card')).toBeNull();
  });

  it('says the leverage list failed and retries that read, instead of an empty filter', () => {
    const refetch = vi.fn();
    leverageState.current = { isLoading: false, isError: true, data: undefined, refetch };
    renderFiltered();

    const text = document.body.textContent ?? '';
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load under-leveraged accounts");
    expect(text).not.toContain('No accounts match your filters');
    expect(text).not.toContain('0 companies');
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.className).toContain('min-h-11');
    expect(retry.className).toContain('focus-visible:ring-2');
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('says the filter matched nothing only after a successful empty leverage list', () => {
    renderFiltered();
    expect(screen.getByText('No accounts match your filters')).toBeTruthy();
    expect(screen.queryByText('Loading under-leveraged accounts')).toBeNull();
  });

  it('shows the accounts the settled leverage list names', () => {
    leverageState.current = {
      isLoading: false,
      isError: false,
      data: {
        items: [{ companyId: 'c-0', companyName: 'Acme 0' }],
        hemaPharmaCount: 1,
      },
      refetch: vi.fn(),
    };
    renderFiltered();
    expect(screen.getAllByTestId('account-card')).toHaveLength(1);
    expect(document.body.textContent).toContain('1 company');
    expect(document.body.textContent).not.toContain('No accounts match your filters');
    expect(document.body.textContent).not.toContain('Loading under-leveraged accounts');
  });
});
