import { useTranslation } from 'react-i18next';

/**
 * LCP text for /dashboard. Rendered by the app shell, outside the lazy route
 * Suspense boundary, and left mounted for the whole visit.
 *
 * WHY it cannot live in DashboardPage: that chunk is the account cockpit
 * (~200KB). Lighthouse's simulated slow-4G graph charges the LCP element to
 * whichever script created the node that is still in the DOM at the end of
 * the trace. A title inside the route chunk — even one that replaces an
 * identical fallback — is timed at ~5.9s. The shell title is created with the
 * main bundle, which is also what paints FCP (~0.9s).
 */
export function DashboardPageTitle() {
  const { t } = useTranslation('crm');
  return (
    <h1 className="page-title">{t('orgDashboard.pageTitle', 'Workspace Command Center')}</h1>
  );
}
