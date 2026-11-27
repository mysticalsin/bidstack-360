import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TopAccount } from '@/hooks/useTopAccounts';

import { AccountsTopSegment } from './AccountsTopSegment';

// WHY: the ranking mixes the same demo codes. The industry button and the
// badge said financial_services. The request has to keep that code so the
// ranking still matches CI Financial.

const seen = vi.hoisted(() => ({
  filters: [] as Array<Record<string, unknown> | undefined>,
}));

const ITEMS: TopAccount[] = [
  {
    id: 'co-ci',
    name: 'CI Financial',
    domain: 'ci.example',
    industry: 'financial_services',
    logoUrl: null,
    tier: 'key',
    topAccountRank: 1,
    totalValue: 1_240_000,
    wonValue: 880_000,
    openDeals: 1,
    contactCount: 2,
    opportunityCount: 3,
  },
  {
    id: 'co-rush',
    name: 'Rush University System for Health',
    domain: 'rush.example',
    industry: 'healthcare',
    logoUrl: null,
    tier: 'key',
    topAccountRank: 2,
    totalValue: 400_000,
    wonValue: 0,
    openDeals: 1,
    contactCount: 1,
    opportunityCount: 1,
  },
];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
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

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({ formatMoney: (value: number) => String(value) }),
}));

vi.mock('@/hooks/useTopAccounts', () => ({
  useTopAccounts: (filters?: Record<string, unknown>) => {
    seen.filters.push(filters);
    return {
      data: { items: ITEMS, source: 'auto' as const },
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));

vi.mock('@/hooks/useKeyAccounts', () => ({
  useAccountIndustries: () => ({
    data: { items: ['financial_services', 'healthcare'] },
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

describe('AccountsTopSegment industry words', () => {
  afterEach(() => {
    cleanup();
    seen.filters.length = 0;
  });

  it('says Financial Services and still filters the ranking by the stored code', () => {
    renderSegment();

    expect(screen.queryByText('financial_services')).toBeNull();
    expect(screen.queryByText('healthcare')).toBeNull();
    expect(screen.getAllByText('Financial Services').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Healthcare').length).toBeGreaterThan(0);

    const select = screen.getByLabelText('Filter top accounts by industry');
    const optionText = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(optionText).toContain('Financial Services');
    expect(optionText).not.toContain('financial_services');

    fireEvent.click(screen.getByRole('button', { name: 'Filter top accounts by Healthcare' }));

    expect(seen.filters.at(-1)?.industry).toBe('healthcare');
    expect((select as HTMLSelectElement).value).toBe('healthcare');
    expect(screen.getAllByText('Healthcare').length).toBeGreaterThan(0);
    expect(screen.queryByText('healthcare')).toBeNull();
  });
});
