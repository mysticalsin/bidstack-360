// Fetches the most recent RFP orchestration for an opportunity so the pipeline
// page can RESUME it after a page refresh. The pipeline store resets on mount
// and the URL only carries the opportunityId (never the orchestrationId), so
// without this the user is dropped back to the upload zone mid-run. The page
// re-seeds the SSE stream from this result only when the state is still
// resumable (see RESUMABLE_STATES) — a finished/failed bid keeps the upload zone.

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface LatestOrchestration {
  orchestration: {
    id: string;
    state: string;
    currentPhase: string | null;
  } | null;
}

// States worth resuming on refresh: an in-flight run or one parked at the human
// approval gate. Terminal states (approved/completed/rejected/failed) are
// intentionally excluded so the user can start a fresh upload instead of being
// trapped on a finished bid.
export const RESUMABLE_STATES = new Set(['queued', 'running', 'awaiting_approval']);

export function useRfpLatestOrchestration(opportunityId: string | undefined) {
  return useQuery<LatestOrchestration>({
    queryKey: ['rfp', opportunityId, 'latest'],
    queryFn: ({ signal }) =>
      api<LatestOrchestration>(`/api/v1/bid-workspaces/${opportunityId}/rfp-latest`, { signal }),
    enabled: !!opportunityId,
    staleTime: 10_000,
  });
}
