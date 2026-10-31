import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { WatchImplication } from '@/hooks/useAccountWatchdog';

export interface WatchdogFeed {
  days: number;
  earnings: Array<{ id: string; companyId: string; companyName: string; fiscalPeriod: string; expectedAt: string; confirmed: boolean }>;
  alerts: Array<{ id: string; companyId: string; companyName: string; title: string; source: string; occurredAt: string; implication: WatchImplication }>;
  newAlertCount: number;
  heat: Array<{ companyId: string; companyName: string; weeks: Array<{ count: number; worst: WatchImplication | null }> }>;
  heatWeekStarts: string[];
}

/** Org-wide watchdog strip for /dashboard (accounts the caller can read). */
export function useWatchdogFeed(days = 30) {
  return useQuery({
    queryKey: ['watchdog-feed', days],
    queryFn: ({ signal }) => api<WatchdogFeed>(`/api/watchdog/feed?days=${days}`, { signal }),
    staleTime: 5 * 60_000,
  });
}
