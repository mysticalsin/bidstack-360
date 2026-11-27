import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeyAccount } from '@/hooks/useKeyAccounts';

import { AccountsKeySegment } from './AccountsKeySegment';

// WHY: Key accounts is a server-filtered, cursor-paged list. Three states were
// telling the wrong story:
//   - while the first page is loading, the page-scoped KPI strip rendered zeros,
//     so a slow response looked like an empty portfolio;
//   - a search or industry that matches nothing reused the first-run copy
//     ("No key accounts yet" / flag companies), which is false when accounts
//     exist but the filter excluded them;
//   - the "Unclassified" industry chip sent that display label to the API as
//     industry=Unclassified. The API only exact-matches a real industry, so
//     accounts with no industry vanished and the list looked empty.
// Top accounts already distinguishes a filter miss and treats unclassified as
// a clear, not a fake industry. These tests fail if Key accounts regresses.

interface KeyQueryFilters {
  search?: string;
  industry?: string;
  limit?: number;
  cursor?: string;
}

const harness = vi.hoisted(() => ({
  calls: [] as Array<KeyQueryFilters | undefined>,
  page: {
    data: undefined as { items: KeyAccount[]; nextCursor: string | null } | undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null as Error | null,
  },
  signalItems: [] as KeyAccount[],
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
  useKeyAccounts: (filters?: KeyQueryFilters) => {
    harness.calls.push(filters);
    // The signal read is the bounded, unfiltered comparison query (limit 200).
    // The page read is what the list and the KPI strip are allowed to trust.
    if (filters?.limit === 200) {
      return {
        data: { items: harness.signalItems, nextCursor: null },
        isLoading: false,
        isError: false,
        isFetching: false,
        error: null,
      };
    }
    return harness.page;
  },
  useAccountIndustries: () => ({
    data: { items: ['Banking'] },
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
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
    openDeals: 1,
    contactCount: 1,
    opportunityCount: 1,
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

function pageIndustries(): Array<string | null> {
  return harness.calls.filter((call) => call?.limit !== 200).map((call) => call?.industry ?? null);
}

describe('AccountsKeySegment empty, loading, and unclassified honesty', () => {
  beforeEach(() => {
    harness.calls = [];
    harness.signalItems = [];
    harness.page = {
      data: { items: [], nextCursor: null },
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
    };
  });

  afterEach(() => cleanup());

  it('does not present a loading page as zero key accounts', () => {
    harness.page = {
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: true,
      error: null,
    };

    renderSegment();

    // Zeros here would be a lie: the page has not loaded, so there is no
    // page total to sum. The first-run empty copy is also wrong — we do not
    // yet know whether the portfolio is empty.
    expect(screen.queryByText('On this page')).toBeNull();
    expect(screen.queryByText('No key accounts yet')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('tells a filtered miss apart from a portfolio that has no key accounts', () => {
    renderSegment();

    expect(screen.getByText('No key accounts yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Browse companies' })).toBeTruthy();
    expect(screen.queryByText('No key accounts match your filters')).toBeNull();

    fireEvent.change(screen.getByLabelText('Filter key accounts by industry'), {
      target: { value: 'Banking' },
    });

    // The industry was sent to the server and matched nothing. That is not
    // "you have no key accounts" — clearing the filter is the next action,
    // not sending the user off to flag companies.
    expect(pageIndustries().at(-1)).toBe('Banking');
    expect(screen.getByText('No key accounts match your filters')).toBeTruthy();
    expect(screen.queryByText('No key accounts yet')).toBeNull();
    expect(screen.queryByText(/Flag strategically important companies/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Browse companies' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(screen.getByText('No key accounts yet')).toBeTruthy();
    expect(screen.queryByText('No key accounts match your filters')).toBeNull();
  });

  it('does not call an empty portfolio until a cleared search has reloaded', async () => {
    vi.useFakeTimers();
    try {
      renderSegment();
      fireEvent.change(screen.getByLabelText('Search key accounts'), {
        target: { value: 'no-such-account' },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      expect(pageIndustries().length).toBeGreaterThan(0);
      expect(
        harness.calls.some((call) => call?.search === 'no-such-account' && call.limit !== 200),
      ).toBe(true);
      expect(screen.getByText('No key accounts match your filters')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

      // The box is clear, but the rows on screen are still the filtered page
      // until the debounced query catches up. Flipping to "No key accounts yet"
      // here would tell the user the portfolio is empty.
      expect(screen.getByLabelText('Search key accounts')).toHaveProperty('value', '');
      expect(screen.getByText('No key accounts match your filters')).toBeTruthy();
      expect(screen.queryByText('No key accounts yet')).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      expect(screen.getByText('No key accounts yet')).toBeTruthy();
      expect(screen.queryByText('No key accounts match your filters')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not query the API with the Unclassified display label', () => {
    const banking = account({
      id: 'bank',
      name: 'Northwind Bank',
      industry: 'Banking',
      totalValue: 500,
    });
    const plain = account({ id: 'plain', name: 'Plain Co', industry: null, totalValue: 80 });
    harness.page = {
      data: { items: [banking, plain], nextCursor: null },
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
    };
    harness.signalItems = [banking, plain];

    renderSegment();

    fireEvent.click(screen.getByRole('button', { name: 'Filter key accounts by Banking' }));
    expect(pageIndustries().at(-1)).toBe('Banking');

    // Accounts with no industry are grouped as "Unclassified" for the chart.
    // That word is not an industry the API can match. Choosing it must clear
    // the filter (same as Top accounts) rather than empty the list.
    fireEvent.click(screen.getByRole('button', { name: 'Clear key account industry filter' }));

    expect(pageIndustries()).not.toContain('Unclassified');
    expect(pageIndustries().at(-1)).toBeNull();
  });
});
