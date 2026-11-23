import '../../styles/org-dashboard.css';

import { lazy, memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { ErrorState } from '@/components/ui/StateMessages';
import { DashboardSkeleton } from '@/components/skeletons/PageSkeletons';
import { useOrgSummary } from '@/hooks/useOrgSummary';

// The loaded cockpit imports every widget. That graph is what made /dashboard
// evaluate motion and a few dozen chunks before it could paint anything
// larger than the shell — Lighthouse's LCP was then the error heading, 13–20s
// later, after the summary's 5xx retries. Load it only once a payload exists.
const OrgDashboardLoaded = lazy(() =>
  import('./OrgDashboardLoaded').then((module) => ({ default: module.OrgDashboardLoaded })),
);

export const OrgDashboard = memo(function OrgDashboard() {
  const { t } = useTranslation('crm');
  const summary = useOrgSummary();

  // No successful payload yet. The page title is rendered by the shell
  // (DashboardPageTitle) so this branch must not mount a second, later h1 —
  // Lighthouse would then time LCP off this chunk. The summary query retries
  // 5xx twice and isError stays false until those finish; the first failure
  // is already the frame a down API ends on, so show it instead of the skeleton.
  if (!summary.data) {
    const failed = summary.isError || (summary.failureCount ?? 0) > 0;
    return (
      <div className="space-y-5">
        {failed ? (
          <ErrorState
            visibleOnMount
            title={t('orgDashboard.errorTitle', 'Could not load dashboard')}
            message={
              summary.error?.message ??
              t('orgDashboard.errorMessage', 'The workspace summary endpoint did not respond.')
            }
            action={
              <button type="button" className="btn btn-secondary" onClick={() => void summary.refetch()}>
                <Icon name="refresh" size={14} />
                {t('orgDashboard.retry', 'Retry')}
              </button>
            }
          />
        ) : (
          <DashboardSkeleton />
        )}
      </div>
    );
  }

  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <OrgDashboardLoaded />
    </Suspense>
  );
});
