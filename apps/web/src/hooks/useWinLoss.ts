import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { WinLossPatterns, WinLossRecord, WinLossRecordUpsert } from '@bidstack/shared';

export function useWinLossPatterns() {
  return useQuery({
    queryKey: ['win-loss', 'patterns'],
    queryFn: ({ signal }) => api<WinLossPatterns>('/api/win-loss/patterns', { signal }),
    staleTime: 60_000,
  });
}

export function useWinLossRecord(opportunityId: string | null) {
  return useQuery({
    queryKey: ['win-loss', 'record', opportunityId],
    queryFn: ({ signal }) =>
      api<WinLossRecord | null>(`/api/win-loss/${opportunityId}`, { signal }),
    enabled: Boolean(opportunityId),
  });
}

export function useUpsertWinLoss() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ opportunityId, body }: { opportunityId: string; body: WinLossRecordUpsert }) =>
      api<WinLossRecord>(`/api/win-loss/${opportunityId}`, { method: 'PUT', body }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['win-loss', 'patterns'] });
      qc.invalidateQueries({ queryKey: ['win-loss', 'record', vars.opportunityId] });
    },
  });
}
