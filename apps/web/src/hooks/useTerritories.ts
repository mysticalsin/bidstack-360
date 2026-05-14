import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Territory, LeadRoutingRule } from '@bidstack/shared';

export interface TerritoryAnalyticsItem {
  countryCode: string;
  countryCodeA3: string;
  opportunityCount: number;
  totalValueEur: number;
  avgProbability: number;
  territories: string[];
  ownerNames: string[];
}

export interface TerritoryAnalytics {
  items: TerritoryAnalyticsItem[];
  totals: {
    totalCountries: number;
    totalValueEur: number;
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

export function useLeadRoutingRules() {
  return useQuery<{ items: LeadRoutingRule[] }>({
    queryKey: ['lead-routing-rules'],
    queryFn: ({ signal }) => api('/api/lead-routing-rules', { signal }),
  });
}

export function useTerritoryAnalytics() {
  return useQuery<TerritoryAnalytics>({
    queryKey: ['territories', 'analytics'],
    queryFn: ({ signal }) => api('/api/territories/analytics', { signal }),
    staleTime: 60_000,
  });
}
