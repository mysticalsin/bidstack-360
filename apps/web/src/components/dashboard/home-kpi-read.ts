/**
 * Home open-pipeline figures are separate reads from the workspace summary.
 * A list or a weighted figure that has not arrived is not an empty book and
 * not a zero. An empty list, or a weighted figure of zero, counts only after
 * that payload has arrived.
 */

export type HomeKpiRead = 'pending' | 'failed' | 'ready';

export interface HomeListQuery<T> {
  isError: boolean;
  isLoading: boolean;
  isFetched: boolean;
  data: { items?: T[] | null } | null | undefined;
}

export interface HomeWeightedQuery {
  isError: boolean;
  isLoading: boolean;
  isFetched: boolean;
  data: { weightedPipeline?: unknown } | null | undefined;
}

function readState(arrived: boolean, query: { isError: boolean; isLoading: boolean; isFetched: boolean }): HomeKpiRead {
  if (arrived) return 'ready';
  if (query.isError || (query.isFetched && !query.isLoading)) return 'failed';
  return 'pending';
}

export function opportunityRowsRead<T>(query: HomeListQuery<T>): { state: HomeKpiRead; rows: T[] } {
  const items = query.data?.items;
  if (Array.isArray(items)) return { state: 'ready', rows: items };
  return { state: readState(false, query), rows: [] };
}

export function weightedPipelineRead(query: HomeWeightedQuery): { state: HomeKpiRead; weighted: number } {
  const value = query.data?.weightedPipeline;
  if (typeof value === 'number' && Number.isFinite(value)) return { state: 'ready', weighted: value };
  return { state: readState(false, query), weighted: 0 };
}
