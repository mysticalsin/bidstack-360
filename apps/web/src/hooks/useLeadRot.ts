import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  LeadStageRotConfig,
  LeadStageRotConfigList,
  LeadStageRotConfigUpsert,
  RecoverySuggestResponse,
} from '@bidstack/shared';

const KEY = 'lead-rot-config';

export function useLeadRotConfig() {
  return useQuery<LeadStageRotConfigList>({
    queryKey: [KEY],
    queryFn: ({ signal }) => api<LeadStageRotConfigList>('/api/lead-rot/config', { signal }),
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
  });
}
