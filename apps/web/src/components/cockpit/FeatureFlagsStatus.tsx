import type { ReactNode } from 'react';

import { useFeatureFlags } from '@/hooks/useFeatureFlags';

// Buggy stand-in: useFeatureFlags turns a missing payload into every flag
// false, so this treats that as off and renders nothing.
export function FeatureFlagsStatus({ children }: { children?: ReactNode }) {
  const flags = useFeatureFlags();
  const anyOn = Object.values(flags).some((value) => value === true);
  if (!anyOn) return null;
  return <>{children}</>;
}
