import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { KeyAccount } from '@/hooks/useKeyAccounts';

import { AccountsKeySegment } from './AccountsKeySegment';

// WHY: demo key accounts store financial_services, healthcare, and
// pharmaceuticals. The industry signal and the badge printed the code.
// Pressing the smaller industry then said that industry "leads the view".
// Northwind (pharmaceuticals, no IT pipeline) is not the leader. The request
// still has to send the stored code, and an account with no industry is not
// a search for the word Unclassified.

const seen = vi.hoisted(() => ({
  filters: [] as Array<Record<string, unknown> | undefined>,
}));

const ITEMS: KeyAccount[] = [
  {
    id: 'co-ci',
    name: 'CI Financial',
    domain: 'ci.example',
    industry: 'financial_services',
    logoUrl: null,
    tier: 'key',
    keyAccountSince: null,
    keyAccountOwnerId: null,
    keyAccountNotes: 'Strategic IT modernization.',
    totalValue: 1_240_000,
    openDeals: 1,
    contactCount: 2,
    opportunityCount: 3,
  },
  {
    id: 'co-northwind',
    name: 'Northwind Pharma',
    domain: 'northwind.example',
    industry: 'pharmaceuticals',
    logoUrl: null,
    tier: 'key',
    keyAccountSince: null,
    keyAccountOwnerId: null,
    keyAccountNotes: 'HEMA MSA, no IT pipeline.',
    totalValue: 0,
    openDeals: 0,
    contactCount: 1,
    opportunityCount: 0,
  },
  {
    id: 'co-blank',
    name: 'Blank Industry',
    domain: null,
    industry: null,
    logoUrl: null,
    tier: 'key',
    keyAccountSince: null,
    keyAccountOwnerId: null,
    keyAccountNotes: null,
    totalValue: 10,
    openDeals: 0,
    contactCount: 0,
    opportunityCount: 0,
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

vi.mock('@/hooks/useKeyAccounts', () => ({
  useKeyAccounts: (filters?: Record<string, unknown>) => {
    seen.filters.push(filters);
    return {
      data: { items: ITEMS, nextCursor: null },
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    };
  },
  useAccountIndustries: () => ({
    data: { items: ['financial_services', 'healthcare', 'pharmaceuticals'] },
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

function pageFilters() {
  return seen.filters.filter((filters) => filters?.limit === 50);
}

function renderSegment() {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AccountsKeySegment />
    </MemoryRouter>,
  );
}

describe('AccountsKeySegment industry words', () => {
  afterEach(() => {
    cleanup();
    seen.filters.length = 0;
  });

  it('says Financial Services and still filters by the stored financial_services code', () => {
    renderSegment();

    expect(screen.queryByText('financial_services')).toBeNull();
    expect(screen.queryByText('pharmaceuticals')).toBeNull();
    expect(screen.getByText('Financial Services leads the view')).toBeTruthy();
    expect(screen.getAllByText('Financial Services').length).toBeGreaterThan(0);

    const select = screen.getByLabelText('Filter key accounts by industry');
    const optionText = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(optionText).toContain('Financial Services');
    expect(optionText).toContain('Healthcare');
    expect(optionText).not.toContain('financial_services');

    fireEvent.click(
      screen.getByRole('button', { name: 'Filter key accounts by Pharmaceuticals' }),
    );

    expect(screen.getByText('Filtered to Pharmaceuticals')).toBeTruthy();
    expect(screen.queryByText(/leads the view/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Filter key accounts by Financial Services' })).toBeTruthy();
    expect((select as HTMLSelectElement).value).toBe('pharmaceuticals');
    expect(pageFilters().at(-1)?.industry).toBe('pharmaceuticals');
    expect(seen.filters.filter((filters) => filters?.limit === 200).at(-1)?.industry).toBeUndefined();
  });

  it('does not search for the word Unclassified when an account has no industry', () => {
    renderSegment();

    fireEvent.click(screen.getByRole('button', { name: 'Clear key account industry filter' }));

    expect(pageFilters().at(-1)?.industry).toBeUndefined();
    expect(screen.queryByText('Unclassified leads the view')).toBeNull();
    expect(screen.getByText('Financial Services leads the view')).toBeTruthy();
  });
});
