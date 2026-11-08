import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type { Company, Opportunity } from '@bidstack/shared';

const PAGE_SIZE = 200;
/** Stop after this many pages so a broken cursor cannot loop forever. */
const MAX_PAGES = 25;

interface CursorPage<T> {
  items: T[];
  nextCursor?: string | null;
}

export interface PagedResult<T> {
  items: T[];
  /** False when the page cap was hit and more rows may exist. */
  complete: boolean;
}

async function fetchAllCursorPages<T>(path: string, signal: AbortSignal): Promise<PagedResult<T>> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) params.set('cursor', cursor);
    const body = await api<CursorPage<T>>(`${path}?${params.toString()}`, { signal });
    items.push(...body.items);
    const next = body.nextCursor ?? null;
    if (!next) return { items, complete: true };
    cursor = next;
  }
  return { items, complete: false };
}

export function useInsightOpportunities() {
  return useQuery({
    queryKey: ['insights', 'opportunities'],
    queryFn: ({ signal }) => fetchAllCursorPages<Opportunity>('/api/opportunities', signal),
    staleTime: 0,
  });
}

export function useInsightCompanies() {
  return useQuery({
    queryKey: ['insights', 'companies'],
    queryFn: ({ signal }) => fetchAllCursorPages<Company>('/api/companies', signal),
    staleTime: 0,
  });
}
