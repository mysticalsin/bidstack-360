import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { keepPreviousTableData, tableFetchState } from '@/lib/table/use-table-query';

import { PROPOSALS_WINDOW, type ProposalPage, type ProposalRow } from './proposals-search-params';

/** Query key for one stage window. `all` is every stage. Search is the settled value. */
export function proposalsListQueryKey(status: string, search: string) {
  return ['proposals', 'list', { status, search }] as const;
}

function fetchProposalWindow(status: string, search: string, signal: AbortSignal) {
  const params = new URLSearchParams({ limit: String(PROPOSALS_WINDOW) });
  if (status !== 'all') params.set('status', status);
  if (search) params.set('search', search);
  return api<ProposalPage>(`/api/v1/proposals?${params.toString()}`, { signal });
}

/**
 * Rows the stage tab should render.
 *
 * A settled empty stage snapshot is not the desk. When a newer all-stages
 * snapshot already contains rows of this stage, that empty snapshot is stale
 * and must not hide them. A newer empty stage snapshot wins: the bid left
 * the stage. Placeholder data is the previous window, still in flight, and
 * stays as it is so the table can keep those rows while the stage loads.
 */
export function resolveProposalStageWindow(input: {
  status: string;
  stageItems: readonly ProposalRow[] | undefined;
  stageUpdatedAt: number;
  stageIsPlaceholder: boolean;
  allItems: readonly ProposalRow[] | undefined;
  allUpdatedAt: number;
}): readonly ProposalRow[] {
  const stageItems = input.stageItems ?? [];
  if (input.status === 'all' || input.stageIsPlaceholder || stageItems.length > 0) {
    return stageItems;
  }
  if (input.allUpdatedAt <= input.stageUpdatedAt || !input.allItems) return stageItems;
  const fromAll = input.allItems.filter((row) => row.status === input.status);
  return fromAll.length > 0 ? fromAll : stageItems;
}

/** An empty table is a filter result, not an empty desk, when any view narrows it. */
export function proposalsEmptyIsFiltered(input: {
  status: string;
  q: string;
  settledSearch: string;
  owner: string;
  dueWindow: string;
  compliance: string;
  windowCount: number;
}): boolean {
  return (
    input.windowCount > 0 ||
    input.status !== 'all' ||
    input.q !== '' ||
    input.settledSearch !== '' ||
    input.owner !== 'all' ||
    input.dueWindow !== 'all' ||
    input.compliance !== 'all'
  );
}

/**
 * The stage window, plus a read of the all-stages snapshot for the same search.
 * The second observer does not fetch. Opening a stage must not start a second
 * list request just to see whether the empty stage cache is stale.
 */
export function useProposalListWindow(status: string, search: string) {
  const windowQuery = useQuery({
    queryKey: proposalsListQueryKey(status, search),
    queryFn: ({ signal }) => fetchProposalWindow(status, search, signal),
    // Keep the previous rows on a filter change and move the pagination
    // spinner, instead of blanking the table.
    placeholderData: keepPreviousTableData,
  });
  const allStagesQuery = useQuery({
    queryKey: proposalsListQueryKey('all', search),
    queryFn: ({ signal }) => fetchProposalWindow('all', search, signal),
    enabled: false,
  });
  const items = useMemo(
    () =>
      resolveProposalStageWindow({
        status,
        stageItems: windowQuery.data?.items,
        stageUpdatedAt: windowQuery.dataUpdatedAt,
        stageIsPlaceholder: windowQuery.isPlaceholderData,
        allItems: status === 'all' ? undefined : allStagesQuery.data?.items,
        allUpdatedAt: status === 'all' ? 0 : allStagesQuery.dataUpdatedAt,
      }),
    [
      allStagesQuery.data,
      allStagesQuery.dataUpdatedAt,
      status,
      windowQuery.data,
      windowQuery.dataUpdatedAt,
      windowQuery.isPlaceholderData,
    ],
  );
  return { windowQuery, items, ...tableFetchState(windowQuery) };
}
