// The strategic-account totals sum the current page. Until that read returns,
// the page is not an empty book, and a later failure must not throw the page
// away.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { KeyAccount } from '@/hooks/useKeyAccounts';

import { AccountsKeySegment } from './AccountsKeySegment';

const read = vi.hoisted(() => ({
  hasData: false,
  isLoading: true,
  isError: false,
  items: [] as KeyAccount[],
  refetch: vi.fn(),
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

vi.mock('@/hooks/useKeyAccounts', () => ({
  useKeyAccounts: () => ({
    data: read.hasData ? { items: read.items, nextCursor: null } : undefined,
    isLoading: read.isLoading,
    isError: read.isError,
    isFetching: read.isLoading,
    error: read.isError ? new Error('down') : null,
    refetch: read.refetch,
  }),
  useAccountIndustries: () => ({
    data: { items: [] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

function account(overrides: Partial<KeyAccount> = {}): KeyAccount {
  return {
    id: 'acc-1',
    name: 'Northwind',
    domain: null,
    industry: 'Pharma',
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

function renderSegment() {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AccountsKeySegment />
    </MemoryRouter>,
  );
}

afterEach(() => {
  read.hasData = false;
  read.isLoading = true;
  read.isError = false;
  read.items = [];
  read.refetch.mockReset();
  cleanup();
});

describe('strategic account totals wait for the read', () => {
  it('does not call a loading page an empty book', () => {
    // WHY: demo key accounts exist. Zeros above the skeleton read as a book
    // with no strategic accounts, no pipeline, and no contacts.
    renderSegment();

    expect(screen.getByText('Loading key accounts')).toBeTruthy();
    expect(screen.queryByText('On this page')).toBeNull();
    expect(screen.queryByText('Key accounts')).toBeNull();
    expect(screen.queryByText('No key accounts yet')).toBeNull();
  });

  it('says the first read failed and does not invent an empty page', () => {
    // WHY: a failed read is not "flag companies as key accounts".
    read.isLoading = false;
    read.isError = true;
    renderSegment();

    expect(screen.getByRole('alert').textContent).toContain("Couldn't load key accounts");
    expect(screen.queryByText('Loading key accounts')).toBeNull();
    expect(screen.queryByText('On this page')).toBeNull();
    expect(screen.queryByText('No key accounts yet')).toBeNull();
  });

  it('shows page totals only after the read settles, including a real empty page', () => {
    // WHY: zero is a real result once the page has arrived. Two accounts on
    // the page are two accounts, not a portfolio total.
    read.hasData = true;
    read.isLoading = false;
    read.items = [account(), account({ id: 'acc-2', name: 'Sanofi', openDeals: 5 })];
    renderSegment();

    const strip = screen.getByLabelText('Key account totals on this page');
    expect(strip.textContent).toContain('On this page');
    expect(strip.textContent).toContain('2');
    expect(screen.getByText('Northwind')).toBeTruthy();
    expect(screen.queryByText('Loading key accounts')).toBeNull();

    cleanup();
    read.items = [];
    renderSegment();
    const emptyStrip = screen.getByLabelText('Key account totals on this page');
    expect(emptyStrip.textContent).toContain('Key accounts');
    expect(emptyStrip.textContent).toContain('0');
    expect(screen.getByText('No key accounts yet')).toBeTruthy();
  });

  it('keeps the page on screen when a later refresh fails', () => {
    // WHY: a failed refresh is not a new empty book. Retry repeats the same read.
    read.hasData = true;
    read.isLoading = false;
    read.isError = true;
    read.items = [account()];
    renderSegment();

    expect(screen.getByText('Northwind')).toBeTruthy();
    expect(screen.getByText('On this page')).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't refresh key accounts");
    expect(alert.textContent).not.toContain('No key accounts yet');
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.className).toContain('min-h-11');
    expect(retry.className).toContain('text-[var(--fg-primary)]');
    expect(retry.className).toContain('focus-visible:ring-2');
    fireEvent.click(retry);
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });
});
