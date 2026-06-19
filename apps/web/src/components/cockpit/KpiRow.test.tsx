import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ElementType, ReactNode } from 'react';

import { KpiRow } from './KpiRow';
import { api } from '@/lib/api';
import type { AccountCockpitSnapshot, CockpitKpi, CrmCompany } from '@bidstack/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({})),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const motionComponent = (tag: ElementType) => {
    const Component = React.forwardRef<HTMLElement, ComponentProps<'div'> & { children?: ReactNode }>(
      ({ children, ...props }, ref) => {
        const {
          animate,
          initial,
          layout,
          transition,
          variants,
          whileHover,
          whileTap,
          ...domProps
        } = props as Record<string, unknown>;
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
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => motionComponent(tag),
      },
    ),
    useMotionValue: (value: number) => ({ get: () => value, set: vi.fn() }),
    useReducedMotion: () => true,
  };
});

function company(overrides: Partial<CrmCompany> = {}): CrmCompany {
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
    ...overrides,
  };
}

function cockpit(kpis: CockpitKpi[]): AccountCockpitSnapshot {
  return {
    company: company(),
    externalLastSyncedAt: '2026-06-01T12:00:00.000Z',
    kpis,
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
}

function renderKpiRow(kpis: CockpitKpi[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <KpiRow cockpit={cockpit(kpis)} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('KpiRow field overrides', () => {
  it('saves KPI overrides against the company name key, not the UUID profile id', async () => {
    renderKpiRow([
      {
        label: 'Industry',
        value: 'Technology',
        detail: 'company profile',
        tone: 'blue',
        sourceLabel: 'External fresh',
        sourceState: 'apollo_fresh',
        sourceHint: 'Synced 2026-06-01',
        block: 'external',
        fieldKey: 'industry',
      },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Override Industry' }));
    fireEvent.change(screen.getByLabelText('New value for Industry'), {
      target: { value: 'Aerospace & Defense' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/api/crm/companies/Acme%20North/field-overrides', {
        method: 'PUT',
        body: { fieldKey: 'industry', value: 'Aerospace & Defense' },
      });
    });
  });

  it('keeps the revert action visible after an overridden KPI moves to Internal Data', async () => {
    renderKpiRow([
      {
        label: 'Industry',
        value: 'Aerospace & Defense',
        detail: 'company profile',
        tone: 'blue',
        sourceLabel: 'Manual override',
        sourceState: 'verified',
        sourceHint: 'Edited by a user',
        block: 'internal',
        overridden: true,
        fieldKey: 'industry',
      },
    ]);

    fireEvent.click(
      screen.getByRole('button', { name: 'Revert Industry to the external source value' }),
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/api/crm/companies/Acme%20North/field-overrides/industry', {
        method: 'DELETE',
      });
    });
  });
});
