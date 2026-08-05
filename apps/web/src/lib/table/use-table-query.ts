// The CLIENT half of D:\CRM\apps\app\components\data-table\use-table-query.ts
// (60 lines). Binds a surface's `createListSearchParams()` declaration to the
// URL through nuqs and returns the `TableQueryState` that table-kit's
// `DataTable` consumes, plus the extras a bid surface needs (search box,
// expansion, page size, two flavours of reset).
//
// `"use client"` is not ported: this is a Vite SPA, every module is client code.
// The CRM's server `load()` has no equivalent here — see the header of
// list-search-params.ts for why it was dropped rather than faked.
//
// MERGE, NEVER REPLACE. Every writer below hands nuqs a PARTIAL object: only the
// named keys are touched, everything else in the query string survives —
// including params owned by a sibling component, which is exactly what the five
// object-form `setSearchParams({ ... })` call sites in
// docs/design-system/url-param-audit.md §4 destroy today. `reset()` clears only
// the keys this surface declared, so it cannot repeat AuditLogSection.tsx:73's
// bug of wiping Settings' `?tab=` on "clear filters".

import { useMemo } from 'react';

import { keepPreviousData } from '@tanstack/react-query';
import { useQueryStates } from 'nuqs';

import {
  EXPANDED_ROWS_KEY,
  type ListInput,
  type ListSearchParams,
  type ListSearchValues,
  type ResolvedListConfig,
} from '@/lib/table/list-search-params';
import type { SortDirection, TableQueryState } from '@/lib/table/table-query';

/**
 * Pagination pushes a history entry so Back walks pages; filters, facets, sort
 * and search replace, because they refine one view rather than move between
 * views. Passed per call instead of per parser so a multi-key write (a facet
 * click that also resets `page`) has one unambiguous history mode.
 * (docs/design-system/url-param-audit.md §6.)
 */
const PUSH = { history: 'push' } as const;

export type ListTableQueryState = TableQueryState & {
  /** Free-text search box value (URL key `q`). */
  q: string;
  setQ: (value: string) => void;
  /** Row ids currently expanded (URL key `expand`, shared with `DataTable`). */
  expanded: readonly string[];
  isExpanded: (rowId: string) => boolean;
  toggleExpanded: (rowId: string) => void;
  setExpanded: (rowIds: readonly string[]) => void;
  setPageSize: (size: number) => void;
  /** Clears every key this surface declared. Foreign params survive. */
  reset: () => void;
  /** Clears search, tab, facets and page. Sort, direction and page size survive. */
  resetFilters: () => void;
};

export type TableQuery<TKey extends string> = {
  /** Pass straight to `<DataTable query={…}>`. */
  query: ListTableQueryState;
  /** Pass to the API call / react-query key. */
  input: ListInput<TKey>;
  /** Raw URL values, for a surface that needs one param verbatim. */
  values: ListSearchValues<TKey>;
};

type SetState = (
  values: Record<string, unknown> | ((old: never) => Record<string, unknown> | null) | null,
  options?: { history?: 'push' | 'replace' },
) => Promise<URLSearchParams>;

/**
 * Every filter-shaped write resets `page` to 1: staying on page 7 of a result
 * set that just shrank to two pages shows an empty table, which the density
 * retarget's "zero blank-table frames" line forbids.
 */
function useFilterSetters(
  setState: SetState,
  keys: readonly string[],
  defaultDir: SortDirection,
) {
  return useMemo(
    () => ({
      setQ: (value: string) => void setState({ q: value || null, page: null }),
      setSort: (id: string) => void setState({ sort: id, page: null }),
      setDir: (dir: SortDirection) => void setState({ dir, page: null }),
      setFilter: (id: string, value: string) => void setState({ [id]: value, page: null }),
      toggleSort: (id: string) =>
        void setState((old: never) => {
          const prev = old as unknown as ListSearchValues<string>;
          return prev.sort === id
            ? { dir: prev.dir === 'asc' ? 'desc' : 'asc', page: null }
            : { sort: id, dir: defaultDir, page: null };
        }),
      // Null clears a key rather than writing its default, so a reset leaves a
      // bare `/proposals` instead of `?status=all&page=1`.
      resetFilters: () =>
        void setState({
          q: null,
          page: null,
          ...Object.fromEntries(keys.map((key) => [key, null])),
        }),
      reset: () => void setState(null),
    }),
    [setState, keys, defaultDir],
  );
}

function useNavigationSetters(setState: SetState, tabId: string | undefined) {
  return useMemo(
    () => ({
      // `page: null` rather than `page: 1` — the default belongs out of the URL.
      setPage: (next: number) => void setState({ page: next > 1 ? next : null }, PUSH),
      setPageSize: (size: number) => void setState({ pageSize: size, page: null }),
      setTab: (value: string) => void (tabId && setState({ [tabId]: value, page: null })),
    }),
    [setState, tabId],
  );
}

function useExpansionSetters(setState: SetState) {
  return useMemo(
    () => ({
      setExpanded: (rowIds: readonly string[]) =>
        void setState({ [EXPANDED_ROWS_KEY]: rowIds.length > 0 ? [...rowIds] : null }),
      toggleExpanded: (rowId: string) =>
        void setState((old: never) => {
          const current = (old as unknown as ListSearchValues<string>).expand;
          const next = current.includes(rowId)
            ? current.filter((id) => id !== rowId)
            : [...current, rowId];
          return { [EXPANDED_ROWS_KEY]: next.length > 0 ? next : null };
        }),
    }),
    [setState],
  );
}

function useTableSetters(
  setState: SetState,
  keys: readonly string[],
  defaultDir: SortDirection,
  tabId: string | undefined,
) {
  const filters = useFilterSetters(setState, keys, defaultDir);
  const navigation = useNavigationSetters(setState, tabId);
  const expansion = useExpansionSetters(setState);
  return useMemo(
    () => ({ ...filters, ...navigation, ...expansion }),
    [filters, navigation, expansion],
  );
}

/** The read-only half of the state — pure, so it needs no memo of its own. */
function readState<TTab extends string, TFacet extends string>(
  values: ListSearchValues<TTab | TFacet>,
  config: ResolvedListConfig<TTab, TFacet>,
  filters: Record<string, string>,
) {
  const { tabId, defaultTab, pageSize } = config;
  return {
    q: values.q,
    sort: values.sort,
    dir: values.dir,
    // A hand-edited `?page=0` is user input, not a contract — clamp it.
    page: values.page > 0 ? values.page : 1,
    pageSize: values.pageSize > 0 ? values.pageSize : pageSize,
    tab: tabId ? (values[tabId] ?? defaultTab) : defaultTab,
    tabId,
    filters,
  };
}

/**
 * Bind a surface's declared params to the URL.
 *
 * ```ts
 * const searchParams = createListSearchParams({ tabId: 'status', facetIds: ['owner'] });
 * const { query, input } = useTableQuery(searchParams);
 * const { data, isPending, isFetching } = useQuery({
 *   queryKey: ['proposals', input],
 *   queryFn: () => api(`/proposals?${new URLSearchParams(input as never)}`),
 *   placeholderData: keepPreviousTableData, // no blank table on a page change
 * });
 * ```
 */
export function useTableQuery<TTab extends string, TFacet extends string>(
  searchParams: ListSearchParams<TTab, TFacet>,
): TableQuery<TTab | TFacet> {
  const { parsers, config, keys, segmentDefaults, toInput } = searchParams;

  const [state, setState] = useQueryStates(parsers);
  const values = state as unknown as ListSearchValues<TTab | TFacet>;
  const write = setState as unknown as SetState;

  const setters = useTableSetters(write, keys, config.defaultDir, config.tabId);

  const filters = useMemo(() => {
    const next: Record<string, string> = {};
    for (const key of keys) next[key] = values[key] ?? segmentDefaults[key] ?? '';
    return next;
  }, [keys, values, segmentDefaults]);

  const expanded = values.expand;

  const query = useMemo<ListTableQueryState>(
    () => ({
      ...readState(values, config, filters),
      expanded,
      isExpanded: (rowId: string) => expanded.includes(rowId),
      ...setters,
    }),
    [values, config, filters, expanded, setters],
  );

  return { query, input: toInput(values), values };
}

// ── keepPreviousData: "no blank table after first paint" ────────────────────
// ROUND2-ULTRAPLAN risk #7 — the port must not feel worse than the RSC source on
// a page change. @tanstack/react-query v5 (5.100.9 here) replaced v4's
// `keepPreviousData: true` flag with `placeholderData: keepPreviousData`; this
// re-export exists so surfaces spell the intent at the call site instead of
// importing a bare identifier whose purpose is invisible.

export { keepPreviousData as keepPreviousTableData };

export type TableFetchResult = {
  /** react-query: no data has ever resolved for this key. */
  isPending: boolean;
  /** react-query: a request is in flight (including a background refetch). */
  isFetching: boolean;
};

export type TableFetchState = {
  /** Cold load — nothing to show yet, render the skeleton. */
  showSkeleton: boolean;
  /** Rows are on screen and stale — keep them, show the pagination spinner. */
  showSpinner: boolean;
};

/**
 * Splits a react-query result into the only two loading affordances a dense
 * table has. The distinction is the whole point: with
 * `placeholderData: keepPreviousTableData`, a page change keeps `isPending`
 * false, so the previous rows stay put and only the spinner moves — the table
 * never blanks. Feed `showSpinner` to `<DataTable loading>` (it forwards to
 * `TablePagination`) and `showSkeleton` to the surface's cold-load skeleton.
 */
export function tableFetchState(result: TableFetchResult): TableFetchState {
  return {
    showSkeleton: result.isPending,
    showSpinner: !result.isPending && result.isFetching,
  };
}
