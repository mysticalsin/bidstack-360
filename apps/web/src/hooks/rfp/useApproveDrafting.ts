import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface ApproveDraftingParams {
  workspaceId: string;
  orchestrationId: string;
}

interface ApproveDraftingResponse {
  status: 'running';
  jobsDispatched: number;
}

export function useApproveDrafting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ workspaceId, orchestrationId }: ApproveDraftingParams) => {
      return api<ApproveDraftingResponse>(`/api/v1/bid-workspaces/${workspaceId}/rfp/${orchestrationId}/approve-drafting`, {
        method: 'POST',
      });
    },
    onSuccess: (_, { workspaceId }) => {
      // Invalidate the latest orchestration and any proposal drafts so the UI refreshes
      queryClient.invalidateQueries({ queryKey: ['rfpLatestOrchestration'] });
      queryClient.invalidateQueries({ queryKey: ['rfpDraft', workspaceId] });
    },
  });
}
