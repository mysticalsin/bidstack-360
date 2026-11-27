import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { KeyAccount } from '@/hooks/useKeyAccounts';

import { AccountsKeySegment } from './AccountsKeySegment';

// WHY: an empty Strategic Accounts page is not a zero pipeline book. The totals
// strip sums the visible page, so a book that has not loaded, a book with no
// key accounts, and an industry filter that matches nothing all render as
// "On this page" / "Total pipeline" 0. The industry signal is a separate read
// that ignores the industry filter, so that same miss still says another
// industry leads the view. Both claims are about a book the page does not have.

type Mode = 'loading' | 'empty' | 'industry-miss';

const state = vi.hoisted(() => ({
  mode: 'empty' as Mode,
}));

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

function account(overrides: Partial<KeyAccount> = {}): KeyAccount {
  return {
    id: 'acc-1',
    name: 'Acme',
    domain: null,
    industry: 'financial_services',
    logoUrl: null,
    tier: 'key',
    keyAccountSince: null,
    keyAccountOwnerId: null,
    keyAccountNotes: null,
    totalValue: 100,
    openDeals: 1,
    contactCount: 1,
    opportunityCount: 1,
    ...overrides,
  };
}

const BOOK: KeyAccount[] = [account({ id: 'acc-acme', name: 'Acme' })];

vi.mock('@/hooks/useKeyAccounts', () => ({
  useKeyAccounts: (query?: { industry?: string }) => {
    if (state.mode === 'loading') {
      return {
        data: undefined,
        isLoading: true,
        isError: false,
        isFetching: true,
        error: null,
        refetch: vi.fn(),
      };
    }
    if (state.mode === 'industry-miss' && query?.industry) {
      return {
        data: { items: [], nextCursor: null },
        isLoading: false,
        isError: false,
        isFetching: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    if (state.mode === 'empty') {
      return {
        data: { items: [], nextCursor: null },
        isLoading: false,
        isError: false,
        isFetching: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    return {
      data: { items: BOOK, nextCursor: null },
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    };
  },
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

describe('AccountsKeySegment empty page is not a zero book', () => {
  afterEach(() => cleanup());

  it('does not print page totals while the key-account read is still loading', () => {
    state.mode = 'loading';
    renderSegment();

    expect(screen.queryByLabelText('Key account totals on this page')).toBeNull();
    expect(screen.queryByText('Total pipeline')).toBeNull();
    expect(screen.queryByText('No key accounts yet')).toBeNull();
  });

  it('does not print a zero pipeline book when the strategic list is empty', () => {
    state.mode = 'empty';
    renderSegment();

    expect(screen.getByText('No key accounts yet')).toBeTruthy();
    expect(screen.queryByLabelText('Key account totals on this page')).toBeNull();
    expect(screen.queryByText('Total pipeline')).toBeNull();
    expect(screen.queryByLabelText('Key account industry signal')).toBeNull();
  });

  it('drops the unfiltered industry leader when the selected industry matches nothing', () => {
    state.mode = 'industry-miss';
    renderSegment();

    fireEvent.change(screen.getByLabelText('Filter key accounts by industry'), {
      target: { value: 'financial_services' },
    });

    expect(screen.getByText('No key accounts yet')).toBeTruthy();
    expect(screen.queryByLabelText('Key account industry signal')).toBeNull();
    expect(screen.queryByText(/leads the view/)).toBeNull();
    expect(screen.queryByLabelText('Key account totals on this page')).toBeNull();
    expect(screen.queryByText('Total pipeline')).toBeNull();
  });
});
