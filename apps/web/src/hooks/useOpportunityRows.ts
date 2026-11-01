import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { OppRow } from '@/components/viz/viz-data';

/** Chart snapshot size. The list is the latest updated bids, not the whole book. */
export const OPPORTUNITY_VIZ_LIMIT = 100;

export interface OpportunityVizPage {
  items: OppRow[];
  nextCursor?: string | null;
}

/** True when the chart snapshot stopped before the rest of the bids. */
export function opportunityVizIsPartial(page: { nextCursor?: string | null } | null | undefined): boolean {
  return Boolean(page?.nextCursor);
}

/** Up to 100 opportunity rows for chart derivations (read-only snapshot). */
export function useOpportunityRows() {
  return useQuery({
    queryKey: ['opportunity-rows:viz'],
    queryFn: ({ signal }) =>
      api<OpportunityVizPage>(`/api/opportunities?limit=${OPPORTUNITY_VIZ_LIMIT}`, { signal }),
    staleTime: 60_000,
  });
}
