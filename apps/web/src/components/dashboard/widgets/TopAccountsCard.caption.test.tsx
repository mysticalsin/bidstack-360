import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TopAccount } from '@/hooks/useTopAccounts';

import { TopAccountsCard } from './TopAccountsCard';

// WHY: the home leaderboard is the curated demo ranking. CI Financial and
// DNB Bank are stored as financial_services, and the badge still says
// "Curated top 10" even when the list is shorter than ten. The English
// catalog owns that sentence. A new default on the old key would not
// change what the card prints. Loading is aria-hidden, so a screen reader
// hears a finished ranking, and a failed read is not an alert.

const catalog = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'public/locales/en/crm.json'), 'utf8'),
) as {
  topAccounts: Record<string, string>;
};

const state = vi.hoisted(() => ({
  isLoading: false,
  isError: false,
  source: 'curated' as 'curated' | 'auto',
  items: [] as TopAccount[],
  refetch: vi.fn(),
}));

function account(partial: Partial<TopAccount> & Pick<TopAccount, 'id' | 'name'>): TopAccount {
  return {
    domain: null,
    industry: null,
    logoUrl: null,
    tier: 'key',
    topAccountRank: null,
    totalValue: 0,
    wonValue: 0,
    openDeals: 0,
    contactCount: 0,
    opportunityCount: 0,
    ...partial,
  };
}

const DEMO: TopAccount[] = [
  account({
    id: 'c0000000-0000-4000-8000-000000000003',
    name: 'Rush University System for Health',
    domain: 'rush.edu',
    industry: 'healthcare',
    topAccountRank: 1,
    totalValue: 4_800_000,
  }),
  account({
    id: 'c0000000-0000-4000-8000-000000000001',
    name: 'CI Financial',
    domain: 'ci.com',
    industry: 'financial_services',
    topAccountRank: 2,
    totalValue: 1_240_000,
  }),
  account({
    id: 'c0000000-0000-4000-8000-000000000008',
    name: 'DNB Bank',
    domain: 'dnb.no',
    industry: 'financial_services',
    topAccountRank: 3,
    totalValue: 2_700_000,
  }),
];

function translate(key: string, fallback?: string, values?: Record<string, unknown>): string {
  const [group, name] = key.split('.');
  const section = (catalog as unknown as Record<string, Record<string, string> | undefined>)[group ?? ''];
  const fromCatalog = name ? section?.[name] : undefined;
  const template = typeof fromCatalog === 'string' ? fromCatalog : (fallback ?? key);
  if (!values) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => String(values[token] ?? ''));
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

function domOnly(props: Record<string, unknown>): Record<string, unknown> {
  const { animate, exit, initial, layout, transition, variants, whileHover, whileTap, ...rest } = props;
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
  },
  useReducedMotion: () => true,
}));

vi.mock('@/hooks/useTopAccounts', () => ({
  useTopAccounts: () => ({
    data: state.isLoading || state.isError ? undefined : { items: state.items, source: state.source },
    isLoading: state.isLoading,
    isError: state.isError,
    error: state.isError ? new Error('ranking unavailable') : null,
    refetch: state.refetch,
  }),
}));

function renderCard() {
  return render(
    <MemoryRouter>
      <TopAccountsCard />
    </MemoryRouter>,
  );
}

describe('home leaderboard caption', () => {
  afterEach(() => {
    cleanup();
    state.isLoading = false;
    state.isError = false;
    state.source = 'curated';
    state.items = [];
    state.refetch.mockReset();
  });

  it('says the demo industries in words and does not call the list a top 10', () => {
    expect(catalog.topAccounts.sourceCurated).toMatch(/top 10/i);
    state.items = DEMO;

    renderCard();

    expect(screen.getByText('Curated ranking')).toBeTruthy();
    expect(screen.queryByText(catalog.topAccounts.sourceCurated)).toBeNull();
    expect(screen.queryByText(/global top 10/i)).toBeNull();
    expect(screen.queryByText('financial_services')).toBeNull();
    expect(screen.queryByText('healthcare')).toBeNull();
    expect(screen.getAllByText('Financial Services')).toHaveLength(2);
    expect(screen.getByText('Healthcare')).toBeTruthy();
    expect(screen.getByLabelText('Rank 1').textContent).toBe('1');
    expect(screen.getByLabelText('Rank 2').textContent).toBe('2');
    expect(screen.getByRole('link', { name: /CI Financial/ }).getAttribute('href')).toBe(
      '/accounts/c0000000-0000-4000-8000-000000000001',
    );

    const src = readFileSync(
      path.resolve(process.cwd(), 'src/components/dashboard/widgets/TopAccountsCard.tsx'),
      'utf8',
    );
    expect(src).not.toContain('topAccounts.sourceCurated');
    expect(src).toContain('leaderboardRowDetail');
  });

  it('keeps a domain when the industry is missing or unknown', () => {
    state.items = [
      account({
        id: 'blank',
        name: 'No Industry',
        domain: 'blank.example',
        industry: null,
        topAccountRank: 1,
      }),
      account({
        id: 'unknown',
        name: 'Unknown Co',
        domain: 'unknown.example',
        industry: 'Unknown industry',
        topAccountRank: 2,
      }),
      account({
        id: 'neither',
        name: 'Portfolio Only',
        domain: null,
        industry: '   ',
        topAccountRank: 3,
      }),
    ];

    renderCard();

    expect(screen.getByText('blank.example')).toBeTruthy();
    expect(screen.getByText('unknown.example')).toBeTruthy();
    expect(screen.getByText(catalog.topAccounts.portfolioAccount)).toBeTruthy();
    expect(screen.queryByText('Unknown industry')).toBeNull();
    expect(screen.queryByText('Unknown Industry')).toBeNull();
  });

  it('says the ranking is loading and does not announce a finished source', () => {
    state.isLoading = true;
    state.items = DEMO;

    renderCard();

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Loading the ranking.');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText(catalog.topAccounts.sourceCurated)).toBeNull();
    expect(screen.queryByText(catalog.topAccounts.sourceAuto)).toBeNull();
    expect(screen.queryByText('Financial Services')).toBeNull();
  });

  it('announces a failed ranking and retries', () => {
    state.isError = true;

    renderCard();

    expect(screen.getByRole('alert').textContent).toContain(catalog.topAccounts.errorMessage);
    fireEvent.click(screen.getByRole('button', { name: catalog.topAccounts.retry }));
    expect(state.refetch).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('announces an empty ranking without the error alert', () => {
    state.items = [];
    state.source = 'auto';

    renderCard();

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('No ranked accounts yet');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(catalog.topAccounts.sourceAuto)).toBeTruthy();
    expect(screen.queryByText(catalog.topAccounts.sourceCurated)).toBeNull();
  });
});
