// A paused or in-flight top-accounts read has no list yet. The ranking
// showed an empty catalog. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TopAccount } from '@/hooks/useTopAccounts';

import { AccountsTopSegment } from './AccountsTopSegment';

const hookMocks = vi.hoisted(() => ({
  useTopAccounts: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) => {
      const template = fallback ?? key;
      if (!values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
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
  useTopAccounts: hookMocks.useTopAccounts,
}));

vi.mock('@/hooks/useKeyAccounts', () => ({
  useAccountIndustries: () => ({
    data: { items: [] as string[] },
    isError: false,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const CHECKING = 'Checking top accounts. The list has not arrived.';
const FAILED = 'Could not load top accounts';
const EMPTY = 'No ranked accounts yet';
const AUTO = 'Auto-ranked by pipeline value';
const ACCOUNT = 'Northwind Advisory';

function account(name: string, industry: string | null): TopAccount {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name,
    domain: 'northwind.example',
    industry,
    logoUrl: null,
    tier: 'key',
    topAccountRank: 1,
    totalValue: 880_000,
    wonValue: 0,
    openDeals: 1,
    contactCount: 2,
    opportunityCount: 1,
  };
}

function list(items: TopAccount[], source: 'curated' | 'auto' = 'curated') {
  return { items, source };
}

function renderRanking(query: {
  data?: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: string;
  error?: Error | null;
}) {
  hookMocks.useTopAccounts.mockReturnValue({
    ...query,
    refetch: vi.fn(),
  });
  render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AccountsTopSegment />
    </MemoryRouter>,
  );
}

describe('AccountsTopSegment read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused top-accounts read as an empty catalog', () => {
    // WHY: a paused first read has isLoading false and no list. An empty
    // ranking says the read arrived. This one has not.
    renderRanking({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText("Couldn't load top accounts")).toBeNull();
    expect(screen.queryByText(AUTO)).toBeNull();
    expect(screen.queryByText(ACCOUNT)).toBeNull();
    expect(screen.queryByText('880000')).toBeNull();
    expect(screen.queryByRole('link', { name: /Browse companies/ })).toBeNull();
    expect(screen.queryByLabelText('Account ranking command panel')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight top-accounts read as an empty catalog', () => {
    // WHY: a slow read also has no list, and isLoading can stay false.
    // The empty catalog must not stand in for a read that is still running.
    renderRanking({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(AUTO)).toBeNull();
    expect(screen.queryByText(ACCOUNT)).toBeNull();
    expect(screen.queryByRole('link', { name: /Browse companies/ })).toBeNull();
    expect(screen.queryByLabelText('Account ranking command panel')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed top-accounts read on the error', () => {
    // WHY: a failed read is not an unread pause. Checking must not stand in
    // for the error, and the catalog must not open.
    renderRanking({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('accounts down'),
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByText('accounts down')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(AUTO)).toBeNull();
    expect(screen.queryByText(ACCOUNT)).toBeNull();
    expect(screen.queryByLabelText('Account ranking command panel')).toBeNull();
  });

  it('lets a failed read win over a stale top account', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // Northwind Advisory on screen.
    renderRanking({
      data: list([account(ACCOUNT, 'advisory')]),
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('accounts down'),
    });

    expect(screen.queryByText(ACCOUNT)).toBeNull();
    expect(screen.queryByText('880000')).toBeNull();
    expect(screen.queryByText(AUTO)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByLabelText('Account ranking command panel')).toBeNull();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: error wins even when the flag has not flipped. A status of error
    // must not keep the stale account, and it must not look like an empty list.
    renderRanking({
      data: list([account(ACCOUNT, 'advisory')]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'error',
      error: new Error('accounts down'),
    });

    expect(screen.queryByText(ACCOUNT)).toBeNull();
    expect(screen.queryByText('880000')).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(AUTO)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays empty when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load, and it is not still checking.
    renderRanking({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(ACCOUNT)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays empty when a settled list has no accounts', () => {
    // WHY: an empty list has arrived. Unread must not replace that settled
    // miss, and the miss must not say the load failed.
    renderRanking({
      data: list([], 'auto'),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByText(AUTO)).toBeTruthy();
    expect(screen.queryByText(ACCOUNT)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded top account', () => {
    // WHY: a loaded payload stays. The unread line must not replace an account
    // the read already returned.
    renderRanking({
      data: list([account(ACCOUNT, 'advisory')]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(ACCOUNT)).toBeTruthy();
    expect(screen.getAllByText('880000').length).toBeGreaterThan(0);
    expect(screen.getByText('Top #1')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded top account with a blank industry', () => {
    // WHY: a blank industry is loaded data. Unread must not drop the account,
    // and the row must not invent an industry.
    renderRanking({
      data: list([account('Harbor Ledger', null)]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText('Harbor Ledger')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
