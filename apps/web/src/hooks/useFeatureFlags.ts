import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type { FeatureFlags } from '@bidstack/shared';

/** Every flag false until the API answers — gated blocks stay hidden, never empty. */
const ALL_OFF: FeatureFlags = {
  winLossDataAvailable: false,
  showRevenueBlock: false,
  infosearchEnabled: false,
  lms360Enabled: false,
  serumEnabled: false,
  serumDemoModeEnabled: false,
};

/**
 * Runtime feature flags (GET /api/config/features). Env-driven server-side;
 * effectively static for a deployment, so cache aggressively.
 */
export function useFeatureFlags(): FeatureFlags {
  const { data } = useQuery({
    queryKey: ['config:features'],
    queryFn: ({ signal }) => api<FeatureFlags>('/api/config/features', { signal }),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
  return data ?? ALL_OFF;
}
