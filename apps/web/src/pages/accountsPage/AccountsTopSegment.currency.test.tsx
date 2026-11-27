import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatUnspecifiedAmount,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';
import type { TopAccount } from '@/hooks/useTopAccounts';

import { AccountsTopSegment } from './AccountsTopSegment';

// WHY: demo Rush is 4,800,000 open and Aritzia's won book is 410,000. Neither
// opportunity stores a currency. Account Ranking was still pricing both as
// euros (and compacting the millions). The ranking must print major units and
// say the currency was not recorded. Open-deal and contact counts stay counts.

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? ''));
    },
  }),
}));

function domOnly(props: Record<string, unknown>): Record<string, unknown> {
  const { animate, exit, initial, layout, transition, variants, whileHover, whileTap, ...rest } =
    props;
  void animate;
  void exit;
  void initial;
  void layout;
  void transition;
  void variants;
  void whileHover;
  void whileTap;
  return rest;
}

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode }) => (
      <div {...domOnly(props as Record<string, unknown>)}>{children}</div>
    ),
    header: ({ children, ...props }: { children?: ReactNode }) => (
      <header {...domOnly(props as Record<string, unknown>)}>{children}</header>
    ),
    section: ({ children, ...props }: { children?: ReactNode }) => (
      <section {...domOnly(props as Record<string, unknown>)}>{children}</section>
    ),
    span: ({ children, ...props }: { children?: ReactNode }) => (
      <span {...domOnly(props as Record<string, unknown>)}>{children}</span>
    ),
  },
  useReducedMotion: () => true,
}));

const RUSH: TopAccount = {
  id: 'c0000000-0000-4000-8000-000000000003',
  name: 'Rush University System for Health',
  domain: 'rush.edu',
  industry: 'healthcare',
  logoUrl: null,
  tier: 'key',
  topAccountRank: 1,
  totalValue: 4_800_000,
  wonValue: 410_000,
  openDeals: 1,
  contactCount: 2,
  opportunityCount: 1,
};

vi.mock('@/hooks/useTopAccounts', () => ({
  useTopAccounts: () => ({
    data: { items: [RUSH], source: 'auto' as const },
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/useKeyAccounts', () => ({
  useAccountIndustries: () => ({
    data: { items: ['healthcare'] },
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

function renderSegment() {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AccountsTopSegment />
    </MemoryRouter>,
  );
}

describe('Account Ranking pipeline is not a euro forecast', () => {
  afterEach(() => cleanup());

  it('prints Rush 4,800,000 and won 410,000 in major units and says the currency was not recorded', () => {
    renderSegment();

    const pipelineAmount = formatUnspecifiedAmount(4_800_000);
    const wonAmount = formatUnspecifiedAmount(410_000);
    const panel = screen.getByLabelText('Account ranking command panel');
    const pipeline = within(panel).getByText('Pipeline').parentElement as HTMLElement;
    const won = within(panel).getByText('Won').parentElement as HTMLElement;

    expect(within(pipeline).getByText(pipelineAmount)).toBeTruthy();
    expect(within(pipeline).getByText(UNSPECIFIED_CURRENCY_BASIS)).toBeTruthy();
    expect(pipeline.textContent).not.toMatch(/€|EUR/);

    expect(within(won).getByText(wonAmount)).toBeTruthy();
    expect(within(won).getByText(UNSPECIFIED_CURRENCY_BASIS)).toBeTruthy();
    expect(won.textContent).not.toMatch(/€|EUR/);

    expect(screen.getAllByText(pipelineAmount).length).toBeGreaterThan(1);
    expect(screen.getAllByText(wonAmount).length).toBeGreaterThan(1);

    const openDeals = within(panel).getByText('Open deals').parentElement as HTMLElement;
    expect(within(openDeals).queryByText(UNSPECIFIED_CURRENCY_BASIS)).toBeNull();
    expect(within(openDeals).getByText('1')).toBeTruthy();
  });
});
