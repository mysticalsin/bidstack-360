// The reference library asks for case studies as soon as the page opens.
// Until that read arrives, an empty table is not a settled library. A paused
// or idle read has no payload and isLoading is false, so the page says
// "No references yet" and offers to add one. An in-flight read is the same
// unread library. That sentence is for a library that arrived empty. It is
// not an empty library, and hiding the Reference Library heading would say
// the page is missing. Under demo synthetic data the library is not empty.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Reference } from '@/hooks/useReferences';

import { ReferencesPage } from './ReferencesPage';

const referenceRead = vi.hoisted(() => ({
  data: undefined as { items: Reference[] } | undefined,
  isPending: false,
  isLoading: false,
  isFetching: false,
  isPaused: false,
  isError: false,
  fetchStatus: 'idle' as 'idle' | 'paused' | 'fetching',
  error: null as Error | null,
  refetch: () => undefined,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/hooks/useReferences', () => ({
  useReferences: () => referenceRead,
  useCreateReference: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteReference: () => ({ mutate: vi.fn(), isPending: false }),
  useUseReference: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => false }));

// Synthetic demo case study. No person, no mailbox. The row is what the
// library shows once the read arrives. It must not be treated as absent
// before that, and it must not be invented as a currency.
const DEMO_TITLE = 'Demo Civic rollout';

const CHECKING = 'Checking references. They have not arrived.';
const FAILED_TITLE = 'Could not load references';
const EMPTY = 'No references yet';
const EMPTY_LIE = /no references yet|library is empty|0 references/i;

function demoReference(): Reference {
  return {
    id: 'ref-demo-civic',
    companyId: null,
    title: DEMO_TITLE,
    description: null,
    industry: null,
    valueMicros: null,
    contactName: null,
    contactEmail: null,
    usageCount: 1,
    lastUsedAt: null,
    documentUrl: null,
    tags: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    company: null,
  };
}

function setRead(next: Partial<typeof referenceRead>) {
  referenceRead.data = undefined;
  referenceRead.isPending = false;
  referenceRead.isLoading = false;
  referenceRead.isFetching = false;
  referenceRead.isPaused = false;
  referenceRead.isError = false;
  referenceRead.fetchStatus = 'idle';
  referenceRead.error = null;
  Object.assign(referenceRead, next);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <NuqsAdapter>{children}</NuqsAdapter>
        </BrowserRouter>
      </QueryClientProvider>
    );
  }
  return render(<ReferencesPage />, { wrapper: Wrapper });
}

function expectLibraryNotSettled() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(EMPTY_LIE)).toBeNull();
  expect(screen.queryByText('Add customer references to build your proposal library.')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Add reference' })).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('searchbox', { name: 'Search references' })).toBeNull();
  expect(screen.queryByText(DEMO_TITLE)).toBeNull();
  expect(screen.queryByLabelText('Loading')).toBeNull();
}

describe('ReferencesPage read', () => {
  beforeEach(() => {
    setRead({ isPending: true, fetchStatus: 'idle' });
    window.history.replaceState(null, '', '/references');
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call an unread reference library empty', () => {
    // WHY: the demo library paints before the request starts. fetchStatus is
    // idle and isLoading is false, so "No references yet" looks like a library
    // that was read and found clear. The synthetic Demo Civic rollout has not
    // been read. That is not an empty library and not a missing page.
    setRead({ isPending: false, isLoading: false, isPaused: false, fetchStatus: 'idle' });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Reference Library' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expectLibraryNotSettled();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
  });

  it('does not call a paused reference library empty', () => {
    // WHY: a paused read (offline demo tab) has no case studies in hand.
    // isLoading is false because the fetch is not running. The empty sentence
    // would say the library already has no references, including Demo Civic rollout.
    setRead({
      isPending: true,
      isLoading: false,
      isFetching: false,
      isPaused: true,
      fetchStatus: 'paused',
    });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Reference Library' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expectLibraryNotSettled();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
  });

  it('does not call an in-flight reference library empty', () => {
    // WHY: the first fetch is the same unread library. A spinner in an empty
    // table is not a result, and "No references yet" is a library that arrived
    // empty. Hiding the heading would say the page is missing.
    setRead({
      isPending: true,
      isLoading: true,
      isFetching: true,
      isPaused: false,
      fetchStatus: 'fetching',
    });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Reference Library' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expectLibraryNotSettled();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
  });

  it('does not call a failed reference read an empty library', () => {
    // WHY: a failed read is not a library that has no case studies and not a
    // page that disappeared. The empty sentence would hide the failure.
    setRead({ isError: true, error: new Error('References unavailable') });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Reference Library' })).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED_TITLE)).toBeTruthy();
    expect(screen.getByText('References unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(DEMO_TITLE)).toBeNull();
  });

  it('keeps a settled empty library empty', () => {
    // WHY: a read that arrived with no case studies really has nothing in the
    // library. That sentence is the result, not a payload that has not arrived.
    setRead({ data: { items: [] } });
    renderPage();

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
    expect(screen.queryByText(DEMO_TITLE)).toBeNull();
  });

  it('keeps a loaded synthetic case study on the library', () => {
    // WHY: a payload that arrived, including one demo Demo Civic rollout row,
    // is the library. The hold is only for a read that has not arrived.
    setRead({ data: { items: [demoReference()] } });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Reference Library' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: new RegExp(DEMO_TITLE) })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('keeps a loaded library when a later read fails', () => {
    // WHY: a refresh that fails does not erase case studies already on screen.
    // The failure sentence is for a read that never arrived.
    setRead({
      data: { items: [demoReference()] },
      isError: true,
      isFetching: false,
      error: new Error('References unavailable'),
    });
    renderPage();

    expect(screen.getByRole('cell', { name: new RegExp(DEMO_TITLE) })).toBeTruthy();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
    expect(screen.queryByText('References unavailable')).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});
