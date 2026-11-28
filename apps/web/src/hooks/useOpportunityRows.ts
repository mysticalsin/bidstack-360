import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { accountBidQuery } from '@/lib/account-bid-rows';
import type { OppRow } from '@/components/viz/viz-data';

import { fetchAllCursorPages } from './useInsightsData';

/**
 * Up to 100 opportunity rows for chart derivations (read-only snapshot).
 * Pass a company uuid to read that account. Anything else stays the portfolio page.
 */
export function useOpportunityRows(companyId?: string | null) {
  const request = accountBidQuery(companyId);
  return useQuery({
    queryKey: request.queryKey,
    queryFn: ({ signal }) => api<{ items: OppRow[] }>(request.path, { signal }),
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
