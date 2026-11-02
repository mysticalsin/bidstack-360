import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { KeyAccount } from '@/hooks/useKeyAccounts';

import { AccountsKeySegment } from './AccountsKeySegment';

// WHY: the KPI strip sums `accounts.data.items` — a single cursor-paginated
// page (≤50 rows), NOT an org-wide aggregate the API never returns. Presenting
// those page sums as unqualified "Total pipeline" / "Open deals" portfolio
// totals silently under-reports and shifts as the user pages (MISTAKES.md
// 2026-06-17: "treated a paginated operational list like a complete snapshot").
// The fix labels the strip "On this page" so the page-scope is explicit. These
// tests fail if that honest scoping is removed and the strip reverts to
// implying portfolio totals.

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? ''));
    },
  }),
}));

// Strip framer-motion-only props so they don't leak onto the DOM node.
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

function account(overrides: Partial<KeyAccount> = {}): KeyAccount {
  return {
    id: 'acc-1',
    name: 'Acme',
    domain: null,
    industry: null,
    logoUrl: null,
    tier: 'key',
    keyAccountSince: null,
    keyAccountOwnerId: null,
    keyAccountNotes: null,
    totalValue: 100,
    openDeals: 2,
    contactCount: 3,
    opportunityCount: 4,
    ...overrides,
  };
}

// A page that is NOT the whole portfolio: nextCursor is set, so more key
// accounts exist beyond these two rows.
const PAGE_ITEMS: KeyAccount[] = [
  account({ id: 'acc-1', name: 'Acme', totalValue: 100, openDeals: 2 }),
  account({ id: 'acc-2', name: 'Globex', totalValue: 200, openDeals: 5 }),
];

vi.mock('@/hooks/useKeyAccounts', () => ({
  useKeyAccounts: () => ({
    data: { items: PAGE_ITEMS, nextCursor: 'more-pages-exist' },
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
  }),
  useAccountIndustries: () => ({
    data: { items: [] },
    isError: false,
    refetch: vi.fn(),
  }),
}));

function renderSegment() {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AccountsKeySegment />
    </MemoryRouter>,
  );
}

describe('AccountsKeySegment KPI strip page-scope honesty', () => {
  // globals:false in vitest.config → testing-library's auto-cleanup is not
  // registered; clear the DOM between renders so getByLabelText stays unique.
  afterEach(() => cleanup());

  it('labels the KPI strip as page-scoped so page sums are not read as portfolio totals', () => {
    renderSegment();

    const strip = screen.getByLabelText('Key account totals on this page');
    expect(within(strip).getByText('On this page')).toBeTruthy();
  });

  it('derives the KPI values from the current page rather than an org-wide total', () => {
    renderSegment();

    const strip = screen.getByLabelText('Key account totals on this page');

    // "Key accounts" reflects this page's row count (2), never a portfolio count
    // the API does not expose.
    const keyAccountsTile = within(strip).getByText('Key accounts').parentElement as HTMLElement;
    expect(within(keyAccountsTile).getByText('2')).toBeTruthy();

    // "Open deals" is the sum over the page (2 + 5), not a portfolio-wide sum.
    const openDealsTile = within(strip).getByText('Open deals').parentElement as HTMLElement;
    expect(within(openDealsTile).getByText('7')).toBeTruthy();
  });
});
