// A search or industry that matches nothing is not an empty strategic book.
// "No key accounts yet" plus "Browse companies" sends someone to flag accounts
// that are already flagged and simply outside this filter.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const book = vi.hoisted(() => ({
  items: [] as KeyAccount[],
}));

function account(overrides: Partial<KeyAccount> = {}): KeyAccount {
  return {
    id: 'acc-1',
    name: 'Acme',
    domain: null,
    industry: 'Energy',
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

vi.mock('@/hooks/useKeyAccounts', () => ({
  useKeyAccounts: (filters?: { search?: string; industry?: string }) => ({
    data: {
      items: filters?.search || filters?.industry ? [] : book.items,
      nextCursor: null,
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
  }),
  useAccountIndustries: () => ({
    data: { items: ['Energy'] },
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

describe('AccountsKeySegment filter miss', () => {
  beforeEach(() => {
    book.items = [account()];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps the empty-book sentence only when no strategic account is flagged', () => {
    book.items = [];
    renderSegment();

    expect(screen.getByRole('heading', { name: 'No key accounts yet' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Browse companies/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'No key accounts match these filters' })).toBeNull();
  });

  it('says an industry filter that matches nothing is not an empty strategic book', () => {
    renderSegment();
    expect(screen.getByRole('link', { name: /Open Acme customer cockpit/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter key accounts by industry'), {
      target: { value: 'Energy' },
    });

    expect(screen.getByRole('heading', { name: 'No key accounts match these filters' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'No key accounts yet' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Browse companies/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Open Acme customer cockpit/ })).toBeNull();
    const clear = screen.getByRole('button', { name: 'Clear filters' });
    expect(clear.className).toContain('btn');
    expect(clear.className).toContain('btn-secondary');

    fireEvent.click(clear);
    expect(screen.getByRole('link', { name: /Open Acme customer cockpit/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'No key accounts match these filters' })).toBeNull();
  });

  it('says a search that matches nothing is not an empty strategic book', async () => {
    vi.useFakeTimers();
    renderSegment();

    fireEvent.change(screen.getByLabelText('Search key accounts'), {
      target: { value: 'NoSuch' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByRole('heading', { name: 'No key accounts match these filters' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'No key accounts yet' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('matching "NoSuch"');

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByRole('link', { name: /Open Acme customer cockpit/ })).toBeTruthy();
  });
});
