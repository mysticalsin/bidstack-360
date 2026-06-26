import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface SectorCountry {
  countryCode: string;
  accountCount: number;
  fteVolume: number | null;
}

export interface SectorAccount {
  id: string;
  name: string;
  domain: string | null;
  countryCode: string;
  employeeCount: number | null;
  source: string;
  confidence: number;
  updatedAt: string;
}

export interface SectorRow {
  sector: string;
  accountCount: number;
  fteVolume: number | null;
  coverage: {
    knownFteAccounts: number;
    verifiedAccounts: number;
    logoAccounts: number;
  };
  countries: SectorCountry[];
  accounts: SectorAccount[];
}

export interface SectorViewResponse {
  generatedAt: string;
  totalAccounts: number;
  classifiedAccounts: number;
  dataQualityWarning: boolean;
  sectors: SectorRow[];
}

export function useSectorView() {
  return useQuery({
    queryKey: ['sector-view'],
    queryFn: ({ signal }) => api<SectorViewResponse>('/api/sector-view', { signal }),
    staleTime: 5 * 60 * 1000,
  });
}
