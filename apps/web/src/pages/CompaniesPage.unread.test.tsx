// The companies page is the account list. Until that list arrives, "No
// accounts on the radar" is a book the page invented. A paused read has no
// payload and isLoading is false, so the empty state fires. An unread read
// is the same lie, including a search that has not been sent. A failed read
// with no payload is an error, not an empty book. A settled empty page still
// says there are no accounts. A company that arrived stays on the list.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCompanies } from '@/hooks/useCompanies';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const template = fallback ?? key;
      if (!opts) return template;
      return Object.entries(opts).reduce(
        (str, [name, value]) => str.replace(`{{${name}}}`, String(value)),
        template,
      );
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: vi.fn(),
  useCreateCompany: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteCompany: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasAdminPermission: vi.fn(() => true),
  useHasPermission: vi.fn(() => true),
}));

vi.mock('@/hooks/useCompanyIntelSummary', () => ({
  useIntelImports: vi.fn(() => ({ data: { items: [] }, isLoading: false, isError: false })),
}));

const CHECKING = 'Checking companies. They have not arrived.';
const EMPTY = 'No accounts on the radar';
const SEARCH_MISS = 'No companies match your search';
const FAILED = 'Failed to load companies';
const SAMPLE = 'Harbor Sample Co';

type ReadStatus = {
  data: unknown;
  isPending: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isPaused: boolean;
  isError: boolean;
  fetchStatus: 'idle' | 'paused' | 'fetching';
  error: Error | null;
  refetch: () => void;
};

function readStatus(next: Partial<ReadStatus> = {}): ReadStatus {
  return {
    data: undefined,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isPaused: false,
    isError: false,
    fetchStatus: 'idle',
    error: null,
    refetch: vi.fn(),
    ...next,
  };
}

function sampleCompany() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    orgId: '22222222-2222-4222-8222-222222222222',
    name: SAMPLE,
    legalName: null,
    domain: 'harbor-sample.example',
    industry: 'Demo',
    employeeCount: 12,
    countryCode: 'NO',
    address: null,
    billingEmail: null,
    taxId: null,
    logoUrl: null,
    website: null,
    source: 'manual',
    confidence: 1,
    enrichedAt: null,
    tier: null,
    parentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function mockCompanies(next: Partial<ReadStatus>) {
  vi.mocked(useCompanies).mockReturnValue(readStatus(next) as ReturnType<typeof useCompanies>);
}

function renderPage(path = '/companies') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<CompaniesPage />, { wrapper: Wrapper });
}

function expectNotInventedEmpty() {
  expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
  expect(screen.queryByRole('heading', { name: SEARCH_MISS })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Add company' })).toBeNull();
  expect(screen.queryByRole('link', { name: /import accounts from CSV/i })).toBeNull();
  expect(screen.queryByText('0 companies visible.')).toBeNull();
  expect(screen.queryByText('Showing latest 50 companies')).toBeNull();
  expect(screen.queryByText(/0 results for/)).toBeNull();
  expect(screen.queryByText('Visible companies')).toBeNull();
  expect(screen.queryByText(SAMPLE)).toBeNull();
}

import { CompaniesPage } from './CompaniesPage';

describe('CompaniesPage unread account list', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call an unread company list an empty book', () => {
    // WHY: the page paints before the company request starts. fetchStatus is
    // idle and isLoading is false, so a missing payload becomes "No accounts
    // on the radar" and "0 companies visible." The list has not been read.
    mockCompanies({ isPending: true, isLoading: false, isPaused: false, fetchStatus: 'idle' });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Companies' })).toBeTruthy();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expectNotInventedEmpty();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });

  it('does not call a paused company list an empty book', () => {
    // WHY: a paused read (offline tab) has no companies. isLoading is false
    // because the fetch is not running. "No accounts on the radar" would say
    // the book already came back empty.
    mockCompanies({
      isPending: true,
      isLoading: false,
      isFetching: false,
      isPaused: true,
      fetchStatus: 'paused',
    });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Companies' })).toBeTruthy();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expectNotInventedEmpty();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });

  it('does not call an unread search a miss', () => {
    // WHY: a search in the URL can render before that query is sent. The
    // empty search sentence would say Harbor matched nothing. The read has
    // not arrived.
    mockCompanies({ isPending: true, isLoading: false, fetchStatus: 'idle' });
    renderPage('/companies?search=harbor');

    expect(screen.getByRole('heading', { name: 'Companies' })).toBeTruthy();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expectNotInventedEmpty();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  it('keeps a settled empty book empty', () => {
    // WHY: a list that arrived with no rows really is empty. "No accounts on
    // the radar" is that result, not a missing payload.
    mockCompanies({ data: { items: [], nextCursor: undefined } });
    renderPage();

    expect(screen.getByRole('heading', { name: EMPTY })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add company' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /import accounts from CSV/i })).toBeTruthy();
    expect(screen.getByText('0 companies visible.')).toBeTruthy();
    expect(screen.getByText('Showing latest 50 companies')).toBeTruthy();
    expect(screen.getByText('Visible companies')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });

  it('keeps a loaded company on the page', () => {
    // WHY: a payload that arrived, including a synthetic demo company, still
    // shows. The hold is only for a list that has not arrived.
    mockCompanies({ data: { items: [sampleCompany()], nextCursor: undefined } });
    renderPage();

    expect(screen.getByText(SAMPLE)).toBeTruthy();
    expect(screen.getByText('1 company visible.')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });

  it('does not call a failed list with no payload an empty book', () => {
    // WHY: a failed read is not zero companies. The error already names the
    // failure. "No accounts on the radar" would invite a new company while
    // the list was never read.
    mockCompanies({
      isError: true,
      error: new Error('Company list unavailable'),
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Companies' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: FAILED })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add company' })).toBeNull();
  });
});
