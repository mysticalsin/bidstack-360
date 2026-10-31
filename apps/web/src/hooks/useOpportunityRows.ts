import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { OppRow } from '@/components/viz/viz-data';

/** Up to 100 opportunity rows for chart derivations (read-only snapshot). */
export function useOpportunityRows() {
  return useQuery({
    queryKey: ['opportunity-rows:viz'],
    queryFn: ({ signal }) => api<{ items: OppRow[] }>('/api/opportunities?limit=100', { signal }),
    staleTime: 60_000,
  });
}
