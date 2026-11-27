import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

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

// Quick Start's "run your first bid/no-bid" row used to flip on a click. A demo
// workspace already has a score (the DNB Bank landing zone). The row follows
// the same list the matrix reads. `limit=1` keeps the payload to a single
// score; only whether one exists is kept. A lead or a deal on the org summary
// is not this signal. A failed read (no opportunities:read) stays unresolved so
// the page can fall back to the click instead of inventing a score.
export function useChecklistBidScoreCount() {
  return useQuery({
    queryKey: ['bid-score', 'checklist-count'],
    queryFn: ({ signal }) =>
      api<{ items: Array<{ id: string }> }>('/api/v1/bid-scores?limit=1', { signal }),
    select: (page) => page.items.length,
    staleTime: 30_000,
    retry: false,
  });
}

export function useBidScoreLatest(opportunityId: string | undefined) {
  return useQuery({
    queryKey: ['bid-score', 'latest', opportunityId],
    queryFn: async () => {
      if (!opportunityId) return null;
      return api<BidScoreItem>(`/api/v1/bid-scores/${opportunityId}/latest`);
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
      qc.invalidateQueries({ queryKey: ['bid-score', 'checklist-count'] });
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
