// The KAM page is a key-account list. Until that list arrives, "No key
// accounts yet" is a book the page invented. A paused or idle read has no
// payload and isLoading is false, so the zero state fires. A failed read
// with no payload is an error, not an empty book. A settled empty list still
// says there are no key accounts. A key account that arrived stays on the page.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { KamAccount } from '@bidstack/shared';

import { useKamAccounts } from '@/hooks/useKamAccounts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: vi.fn(() => true),
}));

vi.mock('@/hooks/useKamAccounts', () => ({
  useKamAccounts: vi.fn(),
  useKamCandidates: vi.fn(() => ({ data: { items: [] }, isLoading: false, isError: false })),
  useDesignateAccount: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('./kamPanels', () => ({
  KamDraftReview: () => null,
  KamHandoffCard: () => null,
  KamInitiativeBoard: () => null,
  KamKpiStrip: () => null,
  KamTodoCard: () => null,
}));

import KamAccountPage from './KamAccountPage';

const CHECKING = 'Checking key accounts. They have not arrived.';
const EMPTY = 'No key accounts yet';
const FAILED = "Couldn't load key accounts";
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

function sampleAccount(): KamAccount {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: SAMPLE,
    logoUrl: null,
    domain: 'harbor-sample.example',
    countryCode: 'NO',
    industry: 'Demo',
    kamStatus: 'active',
    kamOwnerModel: 'presales_driven',
    directorSponsorId: null,
    keyAccountOwnerId: null,
    keyAccountSince: '2026-01-01T00:00:00.000Z',
  };
}

function mockAccounts(next: Partial<ReadStatus>) {
  vi.mocked(useKamAccounts).mockReturnValue(readStatus(next) as ReturnType<typeof useKamAccounts>);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<KamAccountPage />, { wrapper: Wrapper });
}

function expectNotInventedEmpty() {
  expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
  expect(screen.queryByRole('button', { name: /Designate a key account/i })).toBeNull();
  expect(screen.queryByText(SAMPLE)).toBeNull();
}

describe('KamAccountPage unread key-account list', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call an unread key-account list an empty book', () => {
    // WHY: the page paints before the key-account request starts. fetchStatus
    // is idle and isLoading is false, so a missing payload becomes "No key
    // accounts yet" and offers Designate. The list has not been read.
    mockAccounts({ isPending: true, isLoading: false, isPaused: false, fetchStatus: 'idle' });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Key Account Management' })).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotInventedEmpty();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });

  it('does not call a paused key-account list an empty book', () => {
    // WHY: a paused read has no accounts. isLoading is false because the
    // fetch is not running. "No key accounts yet" would say the book already
    // came back empty.
    mockAccounts({
      isPending: true,
      isLoading: false,
      isFetching: false,
      isPaused: true,
      fetchStatus: 'paused',
    });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Key Account Management' })).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotInventedEmpty();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });

  it('keeps a settled empty book empty', () => {
    // WHY: a list that arrived with no rows really is empty. "No key accounts
    // yet" is that result, not a missing payload.
    mockAccounts({ data: { items: [] } });
    renderPage();

    expect(screen.getByRole('heading', { name: EMPTY })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Designate a key account/i })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });

  it('keeps a loaded key account on the page', () => {
    // WHY: a payload that arrived, including a synthetic demo account, still
    // shows. The hold is only for a list that has not arrived.
    mockAccounts({ data: { items: [sampleAccount()] } });
    renderPage();

    expect(screen.getByRole('heading', { name: SAMPLE })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });

  it('does not call a failed list with no payload an empty book', () => {
    // WHY: a failed read is not zero key accounts. The error already names
    // the failure. "No key accounts yet" would invite a designation while
    // the list was never read.
    mockAccounts({
      isError: true,
      error: new Error('Key account list unavailable'),
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Key Account Management' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: FAILED })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('button', { name: /Designate a key account/i })).toBeNull();
  });
});
