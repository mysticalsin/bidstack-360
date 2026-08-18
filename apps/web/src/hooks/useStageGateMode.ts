// Per-org Amaris stage-gate enforcement mode. `mode: null` means the org has
// no override and follows the deployment's STAGE_GATE_MODE default.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { OrgStageGateSettings } from '@bidstack/shared';

const KEY = ['org-settings', 'stage-gate'] as const;

export function useStageGateMode() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api<OrgStageGateSettings>('/api/org-settings/stage-gate', { signal }),
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function useUpdateStageGateMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OrgStageGateSettings) =>
      api<OrgStageGateSettings>('/api/org-settings/stage-gate', { method: 'PUT', body }),
    onSuccess: (data) => {
      queryClient.setQueryData(KEY, data);
    },
  });
}
