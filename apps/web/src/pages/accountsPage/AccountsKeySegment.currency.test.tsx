import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatUnspecifiedAmount,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';
import type { KeyAccount } from '@/hooks/useKeyAccounts';

import { AccountsKeySegment } from './AccountsKeySegment';

// WHY: demo OP-2041 is 1,240,000 and the opportunity row does not store a
// currency. Strategic Accounts was still sending that sum through the euro
// formatter, which compact-prints a euro forecast and can FX-convert it.
// The page must show the major-unit number and say the currency was not recorded.
// An open-deal count is not an amount, so it does not carry that sentence.

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
  id: 'c0000000-0000-4000-8000-000000000001',
  name: 'CI Financial',
  domain: 'ci.com',
  industry: 'financial_services',
  logoUrl: null,
  tier: 'key',
  keyAccountSince: null,
  keyAccountOwnerId: null,
  keyAccountNotes: 'Strategic IT modernization + MSP account — exec sponsor engaged.',
  totalValue: 1_240_000,
  openDeals: 1,
  contactCount: 3,
  opportunityCount: 1,
};

vi.mock('@/hooks/useKeyAccounts', () => ({
  useKeyAccounts: () => ({
    data: { items: [CI], nextCursor: null },
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAccountIndustries: () => ({
    data: { items: ['financial_services'] },
    isError: false,
    error: null,
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

describe('Strategic Accounts pipeline is not a euro forecast', () => {
  afterEach(() => cleanup());

  it('prints CI Financial 1,240,000 in major units and says the currency was not recorded', () => {
    renderSegment();

    const amount = formatUnspecifiedAmount(1_240_000);
    const strip = screen.getByLabelText('Key account totals on this page');
    const pipeline = within(strip).getByText('Total pipeline').parentElement as HTMLElement;
    expect(within(pipeline).getByText(amount)).toBeTruthy();
    expect(within(pipeline).getByText(UNSPECIFIED_CURRENCY_BASIS)).toBeTruthy();
    expect(pipeline.textContent).not.toMatch(/€|EUR/);

    expect(screen.getAllByText(amount).length).toBeGreaterThan(1);
    expect(screen.getAllByText(UNSPECIFIED_CURRENCY_BASIS).length).toBeGreaterThan(1);

    const openDeals = within(strip).getByText('Open deals').parentElement as HTMLElement;
    expect(within(openDeals).queryByText(UNSPECIFIED_CURRENCY_BASIS)).toBeNull();
    expect(within(openDeals).getByText('1')).toBeTruthy();
  });
});
