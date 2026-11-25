import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CrmCompany, CrmDeal } from '@bidstack/shared';

import {
  formatUnspecifiedAmount,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';

import { AccountCard } from './AccountCard';
import { deriveAccount } from './accountUtils';

// Demo OP-2041 is 1,240,000 at 65% and the opportunity row has no currency.
// The card was sending the weighted micros through the euro converter.

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
  return {
    motion: {
      div: ({ children, ...props }: { children?: ReactNode }) => {
        const { animate, exit, initial, layout, transition, whileHover, whileTap, ...domProps } =
          props as Record<string, unknown>;
        void animate;
        void exit;
        void initial;
        void layout;
        void transition;
        void whileHover;
        void whileTap;
        return <div {...domProps}>{children}</div>;
      },
      span: ({ children, ...props }: { children?: ReactNode }) => {
        const { animate, initial, transition, ...domProps } = props as Record<string, unknown>;
        void animate;
        void initial;
        void transition;
        return <span {...domProps}>{children}</span>;
      },
    },
  };
});

vi.mock('@/components/motion/AnimatedMetric', () => ({
  AnimatedMetric: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({ formatMoneyMicros }),
}));

const now = '2026-06-16T12:00:00.000Z';
const OP_2041_MICROS = 1_240_000 * 1_000_000;
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
    logo: null,
    technicalStack: [],
    confidence: 0.87,
    sourceAttribution: [],
    updatedAt: now,
  };
}

function deal(overrides: Partial<CrmDeal> = {}): CrmDeal {
  return {
    id: 'op-2041',
    source: 'external_crm',
    companyId: 'co-ci',
    companyName: 'CI Financial',
    name: 'CI Financial — IT Modernization & MSP',
    stage: 'proposal',
    amountMicros: OP_2041_MICROS,
    currencyCode: null,
    probability: 65,
    closeDate: '2026-07-22',
    ownerId: null,
    ownerName: null,
    updatedAt: now,
    ...overrides,
  };
}

function renderCard(row = deriveAccount(company(), [deal()])) {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AccountCard row={row} index={0} />
    </MemoryRouter>,
  );
}

function pipelineCell() {
  return screen.getByText('Pipeline').parentElement;
}

describe('AccountCard pipeline currency', () => {
  afterEach(() => {
    cleanup();
    formatMoneyMicros.mockClear();
  });

  it('prints demo OP-2041 as a weighted number and does not convert it into euros', () => {
    // WHY: 1,240,000 at 65% is 806,000 of open pipeline. The opportunity table
    // has no currency column, so a euro symbol or a display-currency conversion
    // invents a forecast. A won bid on the same account is not part of that figure.
    renderCard(
      deriveAccount(company(), [
        deal(),
        deal({
          id: 'op-won',
          name: 'CI Financial — Cloud migration phase 1',
          stage: 'closed_won',
          amountMicros: 880_000 * 1_000_000,
          probability: 100,
          currencyCode: null,
        }),
      ]),
    );

    const cell = pipelineCell();
    expect(formatMoneyMicros).not.toHaveBeenCalled();
    expect(cell?.textContent).toContain(WEIGHTED);
    expect(cell?.textContent).toContain(UNSPECIFIED_CURRENCY_BASIS);
    expect(cell?.textContent).not.toMatch(/EUR-CONVERTED|€|EUR|USD/);
    expect(screen.getByRole('link', { name: 'Open CI Financial customer cockpit' })).toBeTruthy();
  });

  it('keeps an empty open book unspecified rather than a zero-euro forecast', () => {
    renderCard(deriveAccount(company(), []));

    const cell = pipelineCell();
    expect(formatMoneyMicros).not.toHaveBeenCalled();
    expect(cell?.textContent).toContain(formatUnspecifiedAmount(0));
    expect(cell?.textContent).toContain(UNSPECIFIED_CURRENCY_BASIS);
    expect(cell?.textContent).not.toMatch(/EUR-CONVERTED|€/);
  });
});
