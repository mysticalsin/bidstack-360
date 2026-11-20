import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { OppRow } from '@/components/viz/viz-data';

import { fetchAllCursorPages } from './useInsightsData';

/** Up to 100 opportunity rows for chart derivations (read-only snapshot). */
export function useOpportunityRows() {
  return useQuery({
    queryKey: ['opportunity-rows:viz'],
    queryFn: ({ signal }) => api<{ items: OppRow[] }>('/api/opportunities?limit=100', { signal }),
    staleTime: 60_000,
  });
}

/** Every opportunity row, walked by cursor, for totals that must not depend on recency. */
export function useAllOpportunityRows() {
  return useQuery({
    queryKey: ['opportunity-rows:viz', 'all'],
    queryFn: ({ signal }) => fetchAllCursorPages<OppRow & { industry?: string | null }>('/api/opportunities', signal),
    staleTime: 60_000,
  });
}
