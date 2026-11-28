// Strategic Accounts is where a regional lead checks CI Financial. The demo
// modernization is still open and was due 22 July 2026. On a later day the
// row and the page total said "1 open deal" with no clock, so a missed close
// read as a healthy book.
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { KeyAccount } from '@/hooks/useKeyAccounts';

import { AccountsKeySegment } from './AccountsKeySegment';

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

const CI: KeyAccount = {
  id: 'ci',
  name: 'CI Financial',
  domain: 'ci.example',
  industry: 'financial_services',
  logoUrl: null,
  tier: 'key',
  keyAccountSince: null,
  keyAccountOwnerId: null,
  keyAccountNotes: null,
  totalValue: 1_240_000,
  openDeals: 1,
  overdueDeals: 1,
  contactCount: 2,
  opportunityCount: 3,
};

const CURRENT: KeyAccount = {
  ...CI,
  id: 'later',
  name: 'Northwind',
  openDeals: 1,
  overdueDeals: 0,
  totalValue: 100,
};

vi.mock('@/hooks/useKeyAccounts', () => ({
  useKeyAccounts: () => ({
    data: { items: [CI, CURRENT], nextCursor: null },
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

afterEach(cleanup);

describe('Strategic Accounts overdue closes', () => {
  it('says a past close is overdue on the account and in the page total, and stays quiet when the book is current', () => {
    render(
      <MemoryRouter>
        <AccountsKeySegment />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('link', { name: 'Open CI Financial customer cockpit, 1 overdue' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Northwind customer cockpit' })).toBeTruthy();

    const strip = screen.getByLabelText('Key account totals on this page');
    expect(within(strip).getByText('1 overdue')).toBeTruthy();
  });
});
