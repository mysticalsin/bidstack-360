import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { featureFlagsPhase } from '@/hooks/feature-flags-read';
import { useFeatureFlagQuery } from '@/hooks/useFeatureFlags';

export function FeatureFlagsStatus({ children }: { children?: ReactNode }) {
  const { t } = useTranslation('crm');
  const query = useFeatureFlagQuery();
  const phase = featureFlagsPhase({
    data: query.data,
    isError: query.isError,
    status: query.status,
  });

  if (phase === 'failed') {
    return (
      <p role="alert">
        {t('featureFlags.loadError', 'Could not load feature flags.')}
      </p>
    );
  }

  if (phase === 'unread') {
    return (
      <p role="status">
        {t('featureFlags.checking', 'Checking feature flags. The read has not arrived.')}
      </p>
    );
  }

  return <>{children}</>;
}
