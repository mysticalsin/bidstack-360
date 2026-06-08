import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface CompetitorInsight {
  id: string;
  competitorProfileId: string;
  opportunityId: string | null;
  category: string;
  status: string;
  title: string;
  summary: string;
  /** Always present — the grounding guarantee (DB column is NOT NULL). */
  sourceUrl: string;
  sourceTitle: string | null;
  provider: string;
  confidenceBps: number;
  publishedAt: string | null;
  retrievedAt: string;
}

export interface CompetitorProfile {
  id: string;
  name: string;
  domain: string | null;
  aliases: string[];
  createdAt: string;
}

const insightsKey = (opportunityId: string | null | undefined) =>
  ['competitor-insights', 'opportunity', opportunityId] as const;

/** Cited competitor insights surfaced for a bid/opportunity. */
export function useOpportunityCompetitorInsights(opportunityId: string | null | undefined) {
  return useQuery({
    queryKey: insightsKey(opportunityId),
    enabled: Boolean(opportunityId),
    queryFn: ({ signal }) =>
      api<{ items: CompetitorInsight[] }>(
        `/api/v1/opportunities/${opportunityId}/competitor-insights`,
        { signal },
      ),
  });
}

/** The org's tracked competitor profiles. */
export function useCompetitors() {
  return useQuery({
    queryKey: ['competitors'],
    queryFn: ({ signal }) => api<{ items: CompetitorProfile[] }>('/api/v1/competitors', { signal }),
  });
}

export function useCreateCompetitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; domain?: string }) =>
      api<CompetitorProfile>('/api/v1/competitors', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['competitors'] }),
  });
}

/** Kick off a grounded research run; insights arrive asynchronously via the worker. */
export function useTriggerCompetitorResearch(opportunityId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { competitorId: string }) =>
      api<{ jobId: string | null; status: string }>(
        `/api/v1/competitors/${vars.competitorId}/research`,
        { method: 'POST', body: { opportunityId: opportunityId ?? undefined } },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: insightsKey(opportunityId) }),
  });
}
