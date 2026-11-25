// The top-account leaderboard ranks by pipeline. Demo CI Financial leads
// with an open bid due 22 July 2026. On a later day that rank still read as
// current open deals.
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TopAccount } from '@/hooks/useTopAccounts';

import { AccountsTopSegment } from './AccountsTopSegment';

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

const CI: TopAccount = {
  id: 'ci',
  name: 'CI Financial',
  domain: 'ci.example',
  industry: 'financial_services',
  logoUrl: null,
  tier: 'key',
  topAccountRank: 1,
  totalValue: 1_240_000,
  wonValue: 0,
  openDeals: 1,
  overdueDeals: 1,
  contactCount: 2,
  opportunityCount: 3,
};

vi.mock('@/hooks/useTopAccounts', () => ({
  useTopAccounts: () => ({
    data: { items: [CI], source: 'auto' as const },
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useKeyAccounts', () => ({
  useAccountIndustries: () => ({
    data: { items: [] },
    isError: false,
    refetch: vi.fn(),
  }),
}));

afterEach(cleanup);

describe('Top accounts overdue closes', () => {
  it('says the leading account’s open deal is already past close', () => {
    render(
      <MemoryRouter>
        <AccountsTopSegment />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('link', { name: 'Open CI Financial customer cockpit, 1 overdue' }),
    ).toBeTruthy();
    const panel = screen.getByLabelText('Account ranking command panel');
    expect(within(panel).getByText('1 overdue')).toBeTruthy();
  });
});
