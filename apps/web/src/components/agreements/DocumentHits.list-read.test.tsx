// A paused or in-flight document search has no hits yet. The section still
// rendered only its heading, or said only that it was searching the files.
// That is not a settled search with no matches. The hits have not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MsaSearchHit, MsaSearchResponse } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  search: {
    data: undefined as MsaSearchResponse | undefined,
    isLoading: false,
    isError: false,
    isSuccess: false,
    status: 'pending' as string,
    fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  },
}));

vi.mock('@/hooks/useMsa', () => ({
  useMsaSearch: () => hookMocks.search,
}));

import { DocumentHits } from './DocumentHits';

const CHECKING = 'Checking document search. The hits have not arrived.';
const FAILED = 'Document search is unavailable right now.';
const EMPTY = /No file text matches/;
const LOADED_TITLE = 'Northwind sample MSA';
const TERM = 'liability';

const loadedHit: MsaSearchHit = {
  contractId: '11111111-1111-4111-8111-111111111111',
  versionId: '22222222-2222-4222-8222-222222222222',
  versionNo: 2,
  title: LOADED_TITLE,
  companyId: '33333333-3333-4333-8333-333333333333',
  kind: 'msa',
  status: 'active',
  rank: 1,
  snippet: 'Sample cap [[850 EUR]]',
};

function settle(
  data: MsaSearchResponse | undefined,
  extra: Partial<typeof hookMocks.search> = {},
) {
  hookMocks.search = {
    data,
    isLoading: false,
    isError: false,
    isSuccess: data !== undefined,
    status: data === undefined ? 'pending' : 'success',
    fetchStatus: 'idle',
    ...extra,
  };
}

function renderHits() {
  return render(
    <MemoryRouter>
      <DocumentHits q={TERM} companyId="33333333-3333-4333-8333-333333333333" enabled />
    </MemoryRouter>,
  );
}

function expectNoSettledSearch() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(LOADED_TITLE)).toBeNull();
  expect(screen.queryByText('Searching the files…')).toBeNull();
}

describe('DocumentHits unread search', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not call a paused document search an empty result', async () => {
    // WHY: a paused first search has isLoading false and no hits. The section
    // rendered only its heading, which reads as a search that found no file text.
    settle(undefined, { status: 'pending', fetchStatus: 'paused', isSuccess: false });
    renderHits();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledSearch();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not call an in-flight document search an empty result', async () => {
    // WHY: a slow search has no hits yet. Saying only that the files are being
    // searched, above a blank body, is not a search that found no file text.
    settle(undefined, {
      isLoading: true,
      isSuccess: false,
      status: 'pending',
      fetchStatus: 'fetching',
    });
    renderHits();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledSearch();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not call a failed document search an empty result', async () => {
    // WHY: a failed search is not evidence that no file text matched. The
    // error stays, and the section does not say nothing matched.
    settle(undefined, { isError: true, isSuccess: false, status: 'error', fetchStatus: 'idle' });
    renderHits();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expectNoSettledSearch();
  });

  it('still says a settled search found no file text', async () => {
    // WHY: a search that arrived with no hits stays empty. A slow network
    // must not be dressed up as that outcome, and this one must.
    settle({ items: [] });
    renderHits();

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.getByText(/New uploads become searchable/)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(LOADED_TITLE)).toBeNull();
  });

  it('still shows a document hit that arrived', async () => {
    // WHY: a loaded hit stays on the list. The unread line must not replace
    // a match the search already returned.
    settle({ items: [loadedHit] });
    renderHits();

    expect(await screen.findByText(LOADED_TITLE)).toBeTruthy();
    expect(screen.getByText('850 EUR')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
