import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import type {
  LeadStageRotConfig,
  LeadStageRotConfigList,
  LeadStageRotConfigUpsert,
  RecoverySuggestResponse,
} from '@bidstack/shared';

const KEY = 'lead-rot-config';

export function useLeadRotConfig(options: { enabled?: boolean } = {}) {
  return useQuery<LeadStageRotConfigList>({
    queryKey: [KEY],
    queryFn: ({ signal }) => api<LeadStageRotConfigList>('/api/lead-rot/config', { signal }),
    enabled: options.enabled ?? true,
  });
}

export function useUpsertLeadRotConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LeadStageRotConfigUpsert) =>
      api<LeadStageRotConfig>('/api/lead-rot/config', { method: 'PUT', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useRecoverySuggest() {
  return useMutation({
    mutationFn: (leadId: string) =>
      api<RecoverySuggestResponse>(`/api/leads/${leadId}/recovery-suggest`, {
        method: 'POST',
        body: {},
      }),
    // RotBadge.onOpen awaits mutateAsync with no catch — a rejected mutation
    // left the recovery-plays menu open and empty with zero feedback.
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not suggest recovery plays'),
  });
}
