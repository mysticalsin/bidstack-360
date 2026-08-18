// React Query hooks for Amaris Bid Office governance: persist an opportunity's
// C0–C4 classification (server computes the class) and record/list formal gate
// sign-off decisions. Mirrors the app's api() + query-key conventions.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { CommitmentLevel } from '@bidstack/shared';

export interface GateDecision {
  id: string;
  opportunityId: string;
  gate: string;
  outcome: string;
  bidClass: string | null;
  decidedById: string | null;
  decidedByRole: string | null;
  justification: string | null;
  decidedAt: string;
}

export interface ClassificationResult {
  bidClass: string;
  sizeBand: string;
  fteEstimate: number;
  commitmentLevel: CommitmentLevel;
}

export function useGateDecisions(opportunityId?: string) {
  return useQuery({
    queryKey: ['gate-decisions', opportunityId],
    enabled: Boolean(opportunityId),
    queryFn: () =>
      api<{ items: GateDecision[] }>(`/api/opportunities/${opportunityId}/gate-decisions`),
  });
}

export function useSaveClassification(opportunityId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { fteEstimate: number; commitmentLevel: CommitmentLevel }) =>
      api<ClassificationResult>(`/api/opportunities/${opportunityId}/classification`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['opportunities'] });
      if (opportunityId) void qc.invalidateQueries({ queryKey: ['opportunity', opportunityId] });
    },
  });
}

export function useRecordGate(opportunityId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      gate: string;
      outcome: string;
      justification?: string;
      decidedByRole?: string;
    }) =>
      api<GateDecision>(`/api/opportunities/${opportunityId}/gate-decisions`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gate-decisions', opportunityId] });
    },
  });
}
