// The behavioural half of the URL-state foundation, run against the SAME stack
// the app boots: react-router v6's BrowserRouter with the real
// `nuqs/adapters/react-router/v6` adapter and happy-dom's History. No testing
// adapter, because the two behaviours that matter most here — merging into a
// query string owned by somebody else, and back/forward — only exist once real
// pushState/replaceState and popstate are in play.
//
// The load-bearing test is "merge, never replace" (url-param-audit.md §4).

import type { ReactNode } from 'react';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { ALL_SEGMENT, createListSearchParams } from '@/lib/table/list-search-params';
import { tableFetchState, useTableQuery } from '@/lib/table/use-table-query';

const proposals = createListSearchParams<'status', 'owner' | 'dueWindow'>({
  tabId: 'status',
  facetIds: ['owner', 'dueWindow'],
  facetDefaults: { dueWindow: 'any' },
  defaultSort: 'dueAt',
  defaultDir: 'desc',
  pageSize: 50,
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <NuqsAdapter>{children}</NuqsAdapter>
    </BrowserRouter>
  );
}

/** Boots the hook at an exact URL, the way a pasted link would. */
function renderAt(url: string) {
  window.history.replaceState(null, '', url);
  return renderHook(() => useTableQuery(proposals), { wrapper });
}

const search = () => new URLSearchParams(window.location.search);

/** nuqs batches URL writes through a throttled queue; wait for the URL, not a tick. */
const expectSearch = (assert: (params: URLSearchParams) => void) =>
  waitFor(() => assert(search()));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/proposals');
});

describe('useTableQuery — reading the URL', () => {
  it('round-trips every param type off a pasted link', async () => {
    const { result } = renderAt(
      '/proposals?status=won&owner=me&dueWindow=week&q=acme&sort=amount&dir=asc&page=3&pageSize=10&expand=r1,r2',
    );

    const { query, input } = result.current;
    expect(query.tab).toBe('won');
    expect(query.tabId).toBe('status');
    expect(query.filters).toEqual({ status: 'won', owner: 'me', dueWindow: 'week' });
    expect(query.q).toBe('acme');
    expect(query.sort).toBe('amount');
    expect(query.dir).toBe('asc');
    expect(query.page).toBe(3);
    expect(query.pageSize).toBe(10);
    expect(query.expanded).toEqual(['r1', 'r2']);
    expect(query.isExpanded('r1')).toBe(true);
    expect(query.isExpanded('r9')).toBe(false);
    expect(input).toEqual({
      q: 'acme',
      sort: 'amount',
      dir: 'asc',
      page: 3,
      pageSize: 10,
      status: 'won',
      owner: 'me',
      dueWindow: 'week',
    });
  });

  it('falls back to the declared defaults on a bare URL', () => {
    const { result } = renderAt('/proposals');
    const { query } = result.current;
    expect(query.tab).toBe(ALL_SEGMENT);
    expect(query.filters).toEqual({ status: ALL_SEGMENT, owner: ALL_SEGMENT, dueWindow: 'any' });
    expect(query.sort).toBe('dueAt');
    expect(query.dir).toBe('desc');
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(50);
    expect(query.expanded).toEqual([]);
  });

  it('clamps a hand-edited page and rejects an unparseable direction', () => {
    const { result } = renderAt('/proposals?page=0&dir=sideways');
    expect(result.current.query.page).toBe(1);
    expect(result.current.input.page).toBe(1);
    expect(result.current.query.dir).toBe('desc');
  });
});

describe('useTableQuery — writing the URL', () => {
  it('round-trips a facet, a tab, a sort and a search term back through state', async () => {
    const { result } = renderAt('/proposals');

    await act(async () => result.current.query.setFilter('owner', 'me'));
    await expectSearch((p) => expect(p.get('owner')).toBe('me'));
    await waitFor(() => expect(result.current.query.filters.owner).toBe('me'));

    await act(async () => result.current.query.setTab('won'));
    await expectSearch((p) => expect(p.get('status')).toBe('won'));
    await waitFor(() => expect(result.current.query.tab).toBe('won'));

    await act(async () => result.current.query.setQ('acme'));
    await expectSearch((p) => expect(p.get('q')).toBe('acme'));
    await waitFor(() => expect(result.current.input.q).toBe('acme'));

    await act(async () => result.current.query.setSort('amount'));
    await expectSearch((p) => expect(p.get('sort')).toBe('amount'));
    await waitFor(() => expect(result.current.query.sort).toBe('amount'));
  });

  it('toggles sort direction on the active column and resets to the default on a new one', async () => {
    const { result } = renderAt('/proposals?sort=amount&dir=asc');

    await act(async () => result.current.query.toggleSort('amount'));
    await waitFor(() => expect(result.current.query.dir).toBe('desc'));

    await act(async () => result.current.query.toggleSort('client'));
    await waitFor(() => expect(result.current.query.sort).toBe('client'));
    expect(result.current.query.dir).toBe('desc'); // defaultDir, not a flip
  });

  it('resets to page 1 on every filter-shaped write', async () => {
    const { result } = renderAt('/proposals?page=4');
    expect(result.current.query.page).toBe(4);

    await act(async () => result.current.query.setFilter('owner', 'me'));
    await waitFor(() => expect(result.current.query.page).toBe(1));
    await expectSearch((p) => expect(p.has('page')).toBe(false));
  });

  it('toggles row expansion and drops the key when nothing is open', async () => {
    const { result } = renderAt('/proposals');

    await act(async () => result.current.query.toggleExpanded('r1'));
    await expectSearch((p) => expect(p.get('expand')).toBe('r1'));

    await act(async () => result.current.query.toggleExpanded('r2'));
    await expectSearch((p) => expect(p.get('expand')).toBe('r1,r2'));

    await act(async () => result.current.query.setExpanded([]));
    await expectSearch((p) => expect(p.has('expand')).toBe(false));
    await waitFor(() => expect(result.current.query.expanded).toEqual([]));
  });
});

describe('useTableQuery — the merge rule (url-param-audit.md §4)', () => {
  it('a facet write preserves params this surface does not own', async () => {
    const { result } = renderAt('/proposals?new=1&tab=overview&status=won');

    await act(async () => result.current.query.setFilter('owner', 'me'));

    await expectSearch((p) => {
      expect(p.get('owner')).toBe('me');
      // The three params a `setSearchParams({ owner: 'me' })` would have destroyed.
      expect(p.get('new')).toBe('1');
      expect(p.get('tab')).toBe('overview');
      expect(p.get('status')).toBe('won');
    });
  });

  it('a page write preserves foreign params', async () => {
    const { result } = renderAt('/proposals?new=1');
    await act(async () => result.current.query.setPage(2));
    await expectSearch((p) => {
      expect(p.get('page')).toBe('2');
      expect(p.get('new')).toBe('1');
    });
  });

  it('reset() clears only this surface’s keys — not the whole query string', async () => {
    // AuditLogSection.tsx:73 does `setSearchParams(new URLSearchParams())` and
    // wipes Settings' `?tab=` along with its own filters. This must not.
    const { result } = renderAt('/proposals?status=won&owner=me&page=3&q=acme&tab=overview&new=1');

    await act(async () => result.current.query.reset());

    await expectSearch((p) => {
      expect(p.has('status')).toBe(false);
      expect(p.has('owner')).toBe(false);
      expect(p.has('page')).toBe(false);
      expect(p.has('q')).toBe(false);
      expect(p.get('tab')).toBe('overview');
      expect(p.get('new')).toBe('1');
    });
    await waitFor(() => expect(result.current.query.tab).toBe(ALL_SEGMENT));
  });

  it('resetFilters() keeps sort, direction and page size', async () => {
    const { result } = renderAt(
      '/proposals?status=won&owner=me&q=acme&page=3&sort=amount&dir=asc&pageSize=10&new=1',
    );

    await act(async () => result.current.query.resetFilters());

    await expectSearch((p) => {
      expect(p.has('status')).toBe(false);
      expect(p.has('owner')).toBe(false);
      expect(p.has('q')).toBe(false);
      expect(p.has('page')).toBe(false);
      expect(p.get('sort')).toBe('amount');
      expect(p.get('dir')).toBe('asc');
      expect(p.get('pageSize')).toBe('10');
      expect(p.get('new')).toBe('1');
    });
  });
});

describe('useTableQuery — defaults never litter the URL', () => {
  it('drops a param written back to its default value', async () => {
    const { result } = renderAt('/proposals?status=won&page=3&dueWindow=week');

    await act(async () => result.current.query.setTab(ALL_SEGMENT));
    await act(async () => result.current.query.setFilter('dueWindow', 'any'));
    await act(async () => result.current.query.setPage(1));

    await expectSearch((p) => {
      expect(p.has('status')).toBe(false);
      expect(p.has('dueWindow')).toBe(false);
      expect(p.has('page')).toBe(false);
    });
  });

  it('drops an emptied search box', async () => {
    const { result } = renderAt('/proposals?q=acme');
    await act(async () => result.current.query.setQ(''));
    await expectSearch((p) => expect(p.has('q')).toBe(false));
  });

  it('writing the default sort direction leaves no dir= behind', async () => {
    const { result } = renderAt('/proposals?dir=asc');
    await act(async () => result.current.query.setDir('desc'));
    await expectSearch((p) => expect(p.has('dir')).toBe(false));
  });
});

describe('useTableQuery — history', () => {
  it('back and forward restore the paged state', async () => {
    const { result } = renderAt('/proposals?status=won');

    await act(async () => result.current.query.setPage(2));
    await expectSearch((p) => expect(p.get('page')).toBe('2'));
    await waitFor(() => expect(result.current.query.page).toBe(2));

    await act(async () => {
      window.history.back();
    });
    await waitFor(() => expect(result.current.query.page).toBe(1));
    expect(search().has('page')).toBe(false);
    expect(result.current.query.tab).toBe('won'); // the rest of the view survives

    await act(async () => {
      window.history.forward();
    });
    await waitFor(() => expect(result.current.query.page).toBe(2));
  });

  it('a filter write replaces rather than pushes, so Back is not a filter undo stack', async () => {
    const { result } = renderAt('/proposals');
    const before = window.history.length;

    await act(async () => result.current.query.setFilter('owner', 'me'));
    await expectSearch((p) => expect(p.get('owner')).toBe('me'));
    expect(window.history.length).toBe(before);

    await act(async () => result.current.query.setPage(2));
    await expectSearch((p) => expect(p.get('page')).toBe('2'));
    expect(window.history.length).toBe(before + 1);
  });
});

describe('tableFetchState', () => {
  it('shows the skeleton only on a cold load', () => {
    expect(tableFetchState({ isPending: true, isFetching: true })).toEqual({
      showSkeleton: true,
      showSpinner: false,
    });
  });

  it('shows the spinner — not the skeleton — while previous rows are kept', () => {
    expect(tableFetchState({ isPending: false, isFetching: true })).toEqual({
      showSkeleton: false,
      showSpinner: true,
    });
  });

  it('shows neither when the data is settled', () => {
    expect(tableFetchState({ isPending: false, isFetching: false })).toEqual({
      showSkeleton: false,
      showSpinner: false,
    });
  });
});
