import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface DraftSection {
  id: string;
  order: number;
  title: string;
  content: string; // HTML from TipTap
  aiGenerated: boolean;
  humanReviewed: boolean;
  lastEditedAt: string | null;
}

interface DraftResult {
  proposalId: string;
  sections: DraftSection[];
}

interface SaveSectionPayload {
  content: string;
  humanReviewed: boolean;
}

export function useRfpDraft(bidWorkspaceId: string | null) {
  const qc = useQueryClient();

  const query = useQuery<DraftResult>({
    queryKey: ['rfp', bidWorkspaceId, 'draft'],
    queryFn: ({ signal }) =>
      api<DraftResult>(`/api/v1/bid-workspaces/${bidWorkspaceId}/draft`, { signal }),
    enabled: !!bidWorkspaceId,
    staleTime: 10_000,
  });

  const saveSection = useMutation({
    mutationFn: ({ sectionId, payload }: { sectionId: string; payload: SaveSectionPayload }) =>
      api<DraftSection>(`/api/v1/bid-workspaces/${bidWorkspaceId}/draft/sections/${sectionId}`, {
        method: 'PATCH',
        body: payload,
      }),
    onSuccess: () => {
      // Invalidate draft so the list reflects the updated humanReviewed flag
      void qc.invalidateQueries({ queryKey: ['rfp', bidWorkspaceId, 'draft'] });
    },
  });

  return { query, saveSection };
}
