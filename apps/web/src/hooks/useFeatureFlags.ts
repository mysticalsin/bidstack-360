import { useQuery } from '@tanstack/react-query';

import { featureFlagsPhase } from '@/hooks/feature-flags-read';
import { api } from '@/lib/api';

import type { FeatureFlags } from '@bidstack/shared';

// Boolean callers only have on or off. They stay off until a payload is ready,
// including after a failed read, so a stale on switch does not linger.
// FeatureFlagsStatus is what says the read has not arrived or failed.
const ALL_OFF: FeatureFlags = {
  winLossDataAvailable: false,
  showRevenueBlock: false,
  infosearchEnabled: false,
  lms360Enabled: false,
  serumEnabled: false,
  serumDemoModeEnabled: false,
  msaLlmExtractEnabled: false,
};

const featureFlagQueryOptions = {
  queryKey: ['config:features'] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    api<FeatureFlags>('/api/config/features', { signal }),
  staleTime: 5 * 60 * 1000,
  gcTime: 30 * 60 * 1000,
};

/**
 * Runtime feature flags (GET /api/config/features). Env-driven server-side;
 * effectively static for a deployment, so cache aggressively.
 * The raw query is what FeatureFlagsStatus phases. This boolean view stays
 * off until that phase is ready.
 */
export function useFeatureFlagQuery() {
  return useQuery(featureFlagQueryOptions);
}

export function useFeatureFlags(): FeatureFlags {
  const query = useFeatureFlagQuery();
  if (featureFlagsPhase(query) !== 'ready') return ALL_OFF;
  return query.data ?? ALL_OFF;
}
