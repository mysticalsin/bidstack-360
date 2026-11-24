import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import { OrgDashboard } from '@/components/dashboard/OrgDashboard';
import { LoadingSkeleton } from '@/components/ui/PlainSkeleton';

// The account cockpit is a separate chunk. The org /dashboard view must not
// evaluate that card graph; its evaluation was a long task on the route
// Lighthouse audits.
const LazyAccountCockpit = lazy(() =>
  import('./AccountCockpitPage').then((m) => ({ default: m.AccountCockpitPage })),
);

function AccountCockpit({ accountId }: { accountId: string }) {
  return (
    <Suspense fallback={<LoadingSkeleton rows={8} />}>
      <LazyAccountCockpit accountId={accountId} />
    </Suspense>
  );
}

// DashboardPage doubles as both the org-wide /dashboard view (no
// accountId) and the per-customer /accounts/:accountId cockpit. The
// useCrmDashboard hook switches its server query based on accountId, so
// the cockpit snapshot in `dashboard.data.cockpit` is always pre-selected
// for the right company — we only need to render the layout here.
export function DashboardPage() {
  const { accountId } = useParams<{ accountId?: string }>();
  const { t } = useTranslation('crm');
  return (
    <>
      <h1 className="sr-only">{t('dashboard.srHeading', 'Dashboard')}</h1>
      {!accountId ? (
        <OrgDashboard />
      ) : (
        <AccountCockpit accountId={accountId} />
      )}
    </>
  );
}
