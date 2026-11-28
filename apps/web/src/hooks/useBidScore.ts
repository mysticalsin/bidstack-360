import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';

interface BidScoreItem {
  id: string;
  opportunityId: string;
  scoredBy: string;
  version: number;
  criteria: Record<string, number>;
  totalScore: number;
  categoryScores: Record<string, number>;
  weightedSum: number;
  totalWeight: number;
  aiSuggested: boolean;
  memosPolicies: string[];
  recommendation: 'bid' | 'no_bid' | 'proceed_with_caution';
  notes: string | null;
  overrideJustification: string | null;
  overriddenBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AICalibrateResponse {
  criteria: Record<string, number>;
  totalScore: number;
  categoryScores: Record<string, number>;
  recommendation: 'bid' | 'no_bid' | 'proceed_with_caution';
  reasoning: string;
  memosPolicies: string[];
}

export function useBidScoreLatest(opportunityId: string | undefined) {
  return useQuery({
    queryKey: ['bid-score', 'latest', opportunityId],
    queryFn: async () => {
      if (!opportunityId) return null;
      try {
        return await api<BidScoreItem | null>(`/api/v1/bid-scores/${opportunityId}/latest`);
      } catch (error) {
        // No score yet is an empty card, not a failed load. A 204 from the
        // API is already null; a 404 from an older server is the same fact.
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: Boolean(opportunityId),
    retry: (failureCount, error: { status?: number }) => {
      if (error?.status === 404) return false;
      return failureCount < 2;
    },
  });
}

export function useCreateBidScore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      opportunityId: string;
      criteria: Record<string, number>;
      notes?: string;
      decision?: 'follow' | 'override';
      override?: { acknowledged: true; justification: string };
    }) => {
      return api<BidScoreItem>('/api/v1/bid-scores', {
        method: 'POST',
        body,
      });
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['bid-score', 'latest', vars.opportunityId] });
    },
  });
}

export function useAICalibrate() {
  return useMutation({
    mutationFn: async (opportunityId: string) => {
      return api<AICalibrateResponse>(`/api/v1/bid-scores/${opportunityId}/ai-calibrate`, {
        method: 'POST',
      });
    },
  });
}

interface DefendResponse {
  reasoning: string;
  sources: string[];
}

export function useBidScoreDefend() {
  return useMutation({
    mutationFn: async (scoreId: string) => {
      return api<DefendResponse>(`/api/v1/bid-scores/${scoreId}/defend`, {
        method: 'POST',
      });
    },
  });
}
