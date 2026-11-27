import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps, ElementType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const template = fallback ?? key;
      if (!opts) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(opts[name] ?? ''));
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({ items: [] })),
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

import { CommandCenter } from './CommandCenter';
import type { AccountCockpitSnapshot, CrmCompany } from '@bidstack/shared';

const UNITS_61520_MICROS = 61_520_000_000;

function digits(text: string | null | undefined): string {
  return (text ?? '').replace(/\D/g, '');
}

function company(id: string): CrmCompany {
  return {
    id,
    source: 'external_crm',
    name: 'Example Industrial',
    legalName: 'Example Industrial',
    domain: 'example.test',
    website: null,
    industry: 'Manufacturing',
    employeeCount: null,
    annualRevenueMicros: UNITS_61520_MICROS,
    status: 'active',
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    logo: null,
    technicalStack: [],
    confidence: 1,
    sourceAttribution: [],
    updatedAt: '2026-06-16T12:00:00.000Z',
  };
}

function cockpit(id: string): AccountCockpitSnapshot {
  return {
    company: company(id),
    kpis: [{ label: 'Pipeline', value: '1', detail: null, tone: 'blue' }],
    technicalStack: [],
    health: { score: 70, band: 'good', counts: {} },
    keyContacts: [],
    recentActivity: [],
    risks: [],
    compliance: [],
    roadmap: [],
  };
}

function weightedAmount(): string {
  const label = screen.getByText('Weighted account value');
  return (label.parentElement?.textContent ?? '').replace('Weighted account value', '').trim();
}

function renderCenter(id: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandCenter cockpit={cockpit(id)} />
    </QueryClientProvider>,
  );
}

describe('command center weighted value under demo data', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not price a synthetic account of 61520 as euros', () => {
    // WHY: annualRevenueMicros has no currency column. The command center sent
    // that integer through an EUR formatter, so a demo account of 61520 units
    // read as a euro baseline. The figure stays 61520 and the row does not
    // name EUR. Readiness math stays parked.
    renderCenter('demo-north');

    const amount = weightedAmount();
    expect(amount).not.toMatch(/EUR|€|CAD|CA\$|USD|\$/);
    expect(digits(amount)).toBe('61520');
  });

  it('does not price a company-id account of 61520 as euros when no sourced figure wins', () => {
    // WHY: the company-id path formats the same micros before the sourced
    // figure can replace them. An empty key-number list must still show the
    // units and must not name EUR.
    renderCenter('8d1c2d4f-09de-4c14-8f98-731e01bc36c9');

    const amount = weightedAmount();
    expect(amount).not.toMatch(/EUR|€|CAD|CA\$|USD|\$/);
    expect(digits(amount)).toBe('61520');
  });
});
