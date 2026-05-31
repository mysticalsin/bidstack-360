// Loads + persists the RFP crew-board arrangement for a workspace (opportunity).
// The board seeds its stations from the saved layout (merged over the roster
// defaults) and PUTs the full map whenever the user drags / keyboard-moves an
// agent. Server sanitizes against the shared roster, so the client can send the
// whole stations map without pre-filtering.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

/** memberKey -> station ('extracting' | … | 'qa_review' | 'oversight'). */
export type CrewLayout = Record<string, string>;

interface LayoutResult {
  layout: CrewLayout;
}

export function useRfpCrewLayout(bidWorkspaceId: string | null) {
  const qc = useQueryClient();
  const key = ['rfp', bidWorkspaceId, 'crew-layout'];

  const query = useQuery<LayoutResult>({
    queryKey: key,
    queryFn: ({ signal }) =>
      api<LayoutResult>(`/api/v1/bid-workspaces/${bidWorkspaceId}/crew-layout`, { signal }),
    enabled: !!bidWorkspaceId,
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: (layout: CrewLayout) =>
      api<LayoutResult>(`/api/v1/bid-workspaces/${bidWorkspaceId}/crew-layout`, {
        method: 'PUT',
        body: { layout },
      }),
    // Keep the cache in sync with the sanitized layout the server echoes back.
    onSuccess: (data) => qc.setQueryData(key, data),
  });

  return { query, save };
}
