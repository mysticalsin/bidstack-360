import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps, ElementType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountCockpitSnapshot, CockpitKpi, CrmCompany } from '@bidstack/shared';

// Revenue and headcount are a React Query read. A paused or in-flight read has
// no payload and isLoading false. That must not look like a settled miss, a
// zero, or a ready figure. A failed read must not keep a stale amount.
const CHECKING = 'Checking sourced figures. The key numbers have not arrived.';
const FAILED = 'Could not load sourced figures.';
const MISSING = 'Not verified';
const ZERO = 'EUR 0';

const numbers = vi.hoisted(() => ({
  current: {
    data: undefined as { items: Array<Record<string, unknown>>; companyName?: string } | null | undefined,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
    fetchStatus: 'paused' as string,
    error: undefined as Error | undefined,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, vars?: Record<string, unknown>) => {
      const text = fallback ?? _key;
      if (!vars) return text;
      return text.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useAccountPositioning', () => ({
  useAccountKeyNumbers: () => numbers.current,
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const motionComponent = (tag: ElementType) => {
    const Component = React.forwardRef<HTMLElement, ComponentProps<'div'> & { children?: ReactNode }>(
      ({ children, ...props }, ref) => {
        const { animate, initial, layout, transition, variants, whileHover, whileTap, ...domProps } =
          props as Record<string, unknown>;
        void animate;
        void initial;
        void layout;
        void transition;
        void variants;
        void whileHover;
        void whileTap;
        return React.createElement(tag, { ...domProps, ref }, children);
      },
    );
    Component.displayName = `Motion${String(tag)}`;
    return Component;
  };
  return {
    animate: (_motion: unknown, value: number, options?: { onUpdate?: (value: number) => void }) => {
      options?.onUpdate?.(value);
      return { stop: vi.fn() };
    },
    motion: new Proxy({}, { get: (_target, tag: string) => motionComponent(tag) }),
    useMotionValue: (value: number) => ({ get: () => value, set: vi.fn() }),
    useReducedMotion: () => true,
  };
});

import { KpiRow } from './KpiRow';

const COMPANY_ID = '8d1c2d4f-09de-4c14-8f98-731e01bc36c9';

function company(id: string): CrmCompany {
  return {
    id,
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

function renderRevenue(value: string, companyId = COMPANY_ID) {
  const kpi: CockpitKpi = {
    label: 'Annual revenue',
    value,
    detail: 'connect Apollo to verify',
    tone: 'amber',
    sourceLabel: 'Needs enrichment',
    sourceState: 'missing',
    sourceHint: 'Connect an external data source',
    block: 'external',
    fieldKey: 'annualRevenueMicros',
  };
  const cockpit: AccountCockpitSnapshot = {
    company: company(companyId),
    externalLastSyncedAt: null,
    kpis: [kpi],
    revenueEvolution: [],
    winLoss: { wonCount: 0, lostCount: 0, wonValueMicros: 0, lostValueMicros: 0, winRate: 0 },
    technicalStack: [],
    health: { score: 80, band: 'good', counts: {}, factors: [] },
    keyContacts: [],
    recentActivity: [],
    risks: [],
    compliance: [],
    roadmap: [],
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <KpiRow cockpit={cockpit} />
    </QueryClientProvider>,
  );
}

function unread(fetchStatus: string) {
  numbers.current = {
    data: undefined,
    isLoading: false,
    isError: false,
    status: 'pending',
    fetchStatus,
    error: undefined,
  };
}

function revenueItem(label = 'Annual report') {
  return {
    id: 'revenue',
    value: 86_100_000_000,
    unit: 'money',
    currency: 'NOK',
    provenance: { origin: 'manual', label, year: null, url: null },
  };
}

describe('kpi sourced figures read', () => {
  afterEach(() => {
    cleanup();
    unread('paused');
  });

  it('does not treat a paused key-numbers read as a missing or zero revenue figure', () => {
    unread('paused');
    renderRevenue(ZERO);
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(MISSING)).toBeNull();
    expect(screen.queryByText('Needs enrichment')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not treat an in-flight key-numbers read as a missing or zero revenue figure', () => {
    unread('fetching');
    renderRevenue(ZERO);
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(MISSING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a failed key-numbers read on the error when isError is true', () => {
    numbers.current = {
      data: undefined,
      isLoading: false,
      isError: true,
      status: 'error',
      fetchStatus: 'idle',
      error: new Error('offline'),
    };
    renderRevenue(MISSING);
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(MISSING)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('drops a stale sourced amount when the read status is error and isError is still false', () => {
    numbers.current = {
      data: { items: [revenueItem()], companyName: 'Acme North' },
      isLoading: false,
      isError: false,
      status: 'error',
      fetchStatus: 'idle',
      error: undefined,
    };
    renderRevenue(MISSING);
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(/NOK/)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still shows the snapshot when the key-numbers list arrived empty', () => {
    numbers.current = {
      data: { items: [], companyName: 'Acme North' },
      isLoading: false,
      isError: false,
      status: 'success',
      fetchStatus: 'idle',
      error: undefined,
    };
    renderRevenue(MISSING);
    expect(screen.getByText(MISSING)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('treats a settled null payload as no sourced figure', () => {
    numbers.current = {
      data: null,
      isLoading: false,
      isError: false,
      status: 'success',
      fetchStatus: 'idle',
      error: undefined,
    };
    renderRevenue(MISSING);
    expect(screen.getByText(MISSING)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a sourced amount that arrived', () => {
    numbers.current = {
      data: { items: [revenueItem()], companyName: 'Acme North' },
      isLoading: false,
      isError: false,
      status: 'success',
      fetchStatus: 'idle',
      error: undefined,
    };
    renderRevenue(MISSING);
    expect(screen.getByText(/NOK/)).toBeTruthy();
    expect(screen.getByTestId('kpi-chip-annualRevenueMicros')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a sourced amount when the source label is blank', () => {
    numbers.current = {
      data: { items: [revenueItem('')], companyName: 'Acme North' },
      isLoading: false,
      isError: false,
      status: 'success',
      fetchStatus: 'idle',
      error: undefined,
    };
    renderRevenue(MISSING);
    expect(screen.getByText(/NOK/)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still shows a settled employee count of zero', () => {
    numbers.current = {
      data: {
        items: [
          {
            id: 'employees',
            value: 0,
            unit: 'count',
            provenance: { origin: 'manual', label: 'Registry', year: null, url: null },
          },
        ],
        companyName: 'Acme North',
      },
      isLoading: false,
      isError: false,
      status: 'success',
      fetchStatus: 'idle',
      error: undefined,
    };
    const kpi: CockpitKpi = {
      label: 'Employees',
      value: 'Headcount pending',
      detail: null,
      tone: 'teal',
      sourceLabel: 'Needs enrichment',
      sourceState: 'missing',
      sourceHint: 'Connect an external data source',
      block: 'external',
      fieldKey: 'employeeCount',
    };
    const cockpit: AccountCockpitSnapshot = {
      company: company(COMPANY_ID),
      externalLastSyncedAt: '2026-06-01T12:00:00.000Z',
      kpis: [kpi],
      revenueEvolution: [],
      winLoss: { wonCount: 0, lostCount: 0, wonValueMicros: 0, lostValueMicros: 0, winRate: 0 },
      technicalStack: [],
      health: { score: 80, band: 'good', counts: {}, factors: [] },
      keyContacts: [],
      recentActivity: [],
      risks: [],
      compliance: [],
      roadmap: [],
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <KpiRow cockpit={cockpit} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByText('Headcount pending')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('does not start a sourced read when the company id is not a uuid', () => {
    unread('paused');
    renderRevenue(MISSING, 'acme-north');
    expect(screen.getByText(MISSING)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
