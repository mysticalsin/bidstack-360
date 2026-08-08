import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import type {
  Territory,
  TerritoryCreate,
  TerritoryPatch,
  LeadRoutingRule,
  LeadRoutingRuleCreate,
  LeadRoutingRulePatch,
} from '@bidstack/shared';

export interface TerritoryAnalyticsItem {
  countryCode: string;
  countryCodeA3: string;
  opportunityCount: number;
  totalValueMicros: number;
  avgProbability: number;
  territories: string[];
  ownerNames: string[];
}

export interface TerritoryAnalytics {
  items: TerritoryAnalyticsItem[];
  totals: {
    totalCountries: number;
    totalValueMicros: number;
    totalOpportunities: number;
    avgProbability: number;
  };
}

export function useTerritories() {
  return useQuery<{ items: Territory[] }>({
    queryKey: ['territories'],
    queryFn: ({ signal }) => api('/api/territories', { signal }),
  });
}

export function useCreateTerritory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TerritoryCreate) =>
      api<Territory>('/api/territories', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['territories'] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create territory'),
  });
}

export function useUpdateTerritory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & TerritoryPatch) =>
      api<Territory>(`/api/territories/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['territories'] });
      qc.invalidateQueries({ queryKey: ['territories', 'analytics'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update territory'),
  });
}

export function useDeleteTerritory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/territories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['territories'] });
      qc.invalidateQueries({ queryKey: ['territories', 'analytics'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not delete territory'),
  });
}

export function useLeadRoutingRules() {
  return useQuery<{ items: LeadRoutingRule[] }>({
    queryKey: ['lead-routing-rules'],
    queryFn: ({ signal }) => api('/api/lead-routing-rules', { signal }),
  });
}

export function useCreateLeadRoutingRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LeadRoutingRuleCreate) =>
      api<LeadRoutingRule>('/api/lead-routing-rules', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-routing-rules'] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create routing rule'),
  });
}

export function useUpdateLeadRoutingRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & LeadRoutingRulePatch) =>
      api<LeadRoutingRule>(`/api/lead-routing-rules/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-routing-rules'] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update routing rule'),
  });
}

export function useDeleteLeadRoutingRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/lead-routing-rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-routing-rules'] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not delete routing rule'),
  });
}

export function useTerritoryAnalytics() {
  return useQuery<TerritoryAnalytics>({
    queryKey: ['territories', 'analytics'],
    queryFn: ({ signal }) => api('/api/territories/analytics', { signal }),
    staleTime: 60_000,
  });
}

// ── Segment breakdown (opps per industry / account, not just region) ──────────
export type SegmentDimension = 'industry' | 'account' | 'country';

export interface TerritorySegment {
  key: string;
  label: string;
  opportunityCount: number;
  totalValueMicros: number;
  avgProbability: number;
  ownerNames: string[];
}

export interface TerritorySegments {
  dimension: SegmentDimension;
  items: TerritorySegment[];
  totals: {
    totalSegments: number;
    totalValueMicros: number;
    totalOpportunities: number;
    avgProbability: number;
  };
}

export function useTerritorySegments(dimension: SegmentDimension) {
  return useQuery<TerritorySegments>({
    queryKey: ['territories', 'segments', dimension],
    queryFn: ({ signal }) =>
      api(`/api/territories/segments?dimension=${dimension}`, { signal }),
    staleTime: 60_000,
    // 'region' uses the world map (useTerritoryAnalytics); segments only fetch
    // for the industry/account dimensions.
    enabled: dimension !== 'country',
  });
}
