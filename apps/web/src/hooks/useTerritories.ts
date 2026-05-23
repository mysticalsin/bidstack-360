import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
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
  });
}

export function useUpdateLeadRoutingRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & LeadRoutingRulePatch) =>
      api<LeadRoutingRule>(`/api/lead-routing-rules/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-routing-rules'] }),
  });
}

export function useDeleteLeadRoutingRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/lead-routing-rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-routing-rules'] }),
  });
}

export function useTerritoryAnalytics() {
  return useQuery<TerritoryAnalytics>({
    queryKey: ['territories', 'analytics'],
    queryFn: ({ signal }) => api('/api/territories/analytics', { signal }),
    staleTime: 60_000,
  });
}
