/**
 * usePredictiveScore — React Query hooks for ML-backed lead and opportunity scores.
 *
 * WHY two hooks:
 *   Lead score and opportunity score have different response shapes and
 *   are consumed in different page contexts. Separate hooks keep each
 *   consumer's dependency surface minimal.
 *
 * Cache:
 *   - Server caches scores for 1h (Redis TTL).
 *   - React Query staleTime mirrors server TTL so the browser doesn't
 *     re-fetch on every render cycle.
 *   - Scores are invalidated on lead/opp mutation via invalidateQueries.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────

export interface ScoreFactor {
  feature: string;
  contribution: number;
}

export interface LeadScore {
  score: number; // 0-100
  factors: ScoreFactor[];
  modelVersion: string;
  scoredAt: string;
}

export interface OppScore {
  winProbability: number; // 0-100
  predictedCloseDate: string | null;
  factors: ScoreFactor[];
  recommendation: string;
  modelVersion: string;
  scoredAt: string;
}

export interface PredictiveModelRow {
  id: string;
  entityType: string;
  version: number;
  isActive: boolean;
  sampleCount: number;
  accuracyMetrics: {
    precision: number;
    recall: number;
    auc: number;
    f1: number;
  };
  trainedAt: string;
  modelArtifactS3Key: string;
}

// ─── Query keys ───────────────────────────────────────────────────────────

export const LEAD_SCORE_KEY = (leadId: string) => ['predictive', 'lead', leadId] as const;
export const OPP_SCORE_KEY = (oppId: string) => ['predictive', 'opportunity', oppId] as const;
export const PREDICTIVE_MODELS_KEY = (entityType?: string) =>
  ['predictive', 'models', entityType ?? 'all'] as const;

const STALE_TIME_MS = 55 * 60 * 1000; // 55 min — just under server's 1h TTL

// ─── Hooks ────────────────────────────────────────────────────────────────

/** Returns ML-computed lead score (0-100) with SHAP factors. */
export function useLeadScore(leadId: string | undefined) {
  return useQuery<LeadScore>({
    queryKey: LEAD_SCORE_KEY(leadId ?? ''),
    queryFn: ({ signal }) => api<LeadScore>(`/api/v1/leads/${leadId}/score`, { signal }),
    enabled: Boolean(leadId),
    staleTime: STALE_TIME_MS,
    retry: 1,
  });
}

/** Returns ML-computed opportunity win probability (0-100) with SHAP factors. */
export function useOppScore(oppId: string | undefined) {
  return useQuery<OppScore>({
    queryKey: OPP_SCORE_KEY(oppId ?? ''),
    queryFn: ({ signal }) => api<OppScore>(`/api/v1/opportunities/${oppId}/score`, { signal }),
    enabled: Boolean(oppId),
    staleTime: STALE_TIME_MS,
    retry: 1,
  });
}

/** Lists trained models for the org. Admin only. */
export function usePredictiveModels(entityType?: 'lead' | 'opportunity') {
  const params = entityType ? `?entityType=${entityType}` : '';
  return useQuery<{ items: PredictiveModelRow[] }>({
    queryKey: PREDICTIVE_MODELS_KEY(entityType),
    queryFn: ({ signal }) =>
      api<{ items: PredictiveModelRow[] }>(`/api/v1/admin/predictive/models${params}`, {
        signal,
      }),
    staleTime: 5 * 60 * 1000, // 5 min for model list
  });
}

/** Triggers a manual model retrain. Returns the enqueued job ID. */
export function useRetrainModel() {
  const queryClient = useQueryClient();
  return useMutation<{ jobId: string | null; message: string }, Error, { entityType?: 'lead' | 'opportunity' }>({
    mutationFn: ({ entityType }) =>
      api<{ jobId: string | null; message: string }>('/api/v1/admin/predictive/retrain', {
        method: 'POST',
        body: entityType ? { entityType } : {},
      }),
    onSuccess: () => {
      // Invalidate model list so the admin page refreshes after retrain is queued
      queryClient.invalidateQueries({ queryKey: ['predictive', 'models'] });
    },
  });
}
