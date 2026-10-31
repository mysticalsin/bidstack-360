import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type WatchImplication = 'OPPORTUNITY' | 'RISK' | 'NEUTRAL';

export interface AccountWatchdog {
  companyId: string;
  monitoring: {
    enabled: boolean;
    identifiers: string[];
    lastCheckedAt: string | null;
    lastError: string | null;
  };
  events: Array<{
    id: string;
    source: string;
    kind: string;
    title: string;
    summary: string;
    sourceUrl: string;
    occurredAt: string;
    implication: WatchImplication;
    implicationRationale: string | null;
    severity: number;
    status: string;
  }>;
  earnings: Array<{
    id: string;
    fiscalPeriod: string;
    expectedAt: string;
    confirmed: boolean;
    source: string;
    sourceUrl: string;
  }>;
  pastProjects: Array<{
    id: string;
    name: string;
    outcome: 'won' | 'lost';
    valueMicros: string;
    closedAt: string;
  }>;
  history: Array<{ id: string; at: string; type: 'filing' | 'opportunity'; title: string; detail: string }>;
}

export function useAccountWatchdog(companyId: string | undefined) {
  return useQuery({
    queryKey: ['account-watchdog', companyId],
    enabled: Boolean(companyId),
    queryFn: ({ signal }) =>
      api<AccountWatchdog>(`/api/accounts/${encodeURIComponent(companyId!)}/watchdog`, { signal }),
    staleTime: 5 * 60_000,
  });
}
