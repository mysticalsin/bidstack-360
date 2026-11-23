/**
 * The org dashboard heading paints with the app shell.
 *
 * DashboardPage is a lazy route. Its widget graph is a long chain of shared
 * chunks, and the heading used to live inside that graph behind an opacity-0
 * entrance. On a fast runner the text still appeared in about a second, but
 * Lighthouse's mobile simulation (150ms RTT, ~1.6Mbps, 4x CPU) treated the
 * whole chain as the LCP dependency and scored Largest Contentful Paint at
 * ~13s. The login screen passes the same gate because its largest text is in
 * the shell bundle.
 *
 * This heading is that shell text: one visible h1 and a short lead that wraps
 * to more area than the hero line below it, so a later widget paint does not
 * move LCP. The lazy page fills in the live counts underneath.
 */
import { Suspense } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { DashboardPage } from '@/routes/lazyPages';

export function DashboardFirstPaint() {
  const { t } = useTranslation('crm');
  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? t('orgDashboard.greetingMorning', 'Good morning')
      : hour < 18
        ? t('orgDashboard.greetingAfternoon', 'Good afternoon')
        : t('orgDashboard.greetingEvening', 'Good evening');

  return (
    <>
      <header className="page-head">
        <div>
          <div className="text-xs font-medium text-[var(--brand-primary)] mb-1">{greeting}</div>
          <h1 className="page-title gradient-text">
            {t('orgDashboard.pageTitle', 'Workspace Command Center')}
          </h1>
        </div>
        <div className="page-actions">
          <Link to="/accounts" className="btn btn-secondary">
            <Icon name="building" size={14} />
            {t('orgDashboard.allAccounts', 'All accounts')}
          </Link>
          <Link to="/opportunities" className="btn btn-primary">
            <Icon name="plus" size={14} />
            {t('orgDashboard.opportunities', 'Opportunities')}
          </Link>
        </div>
      </header>
      <p className="dashboard-lead">
        {t(
          'orgDashboard.lead',
          'Open bids, overdue follow-ups, and the work closing in the next seven days.',
        )}
      </p>
      {/* Catch the lazy page here so this heading stays painted while the
          widget chunk loads. The shell-level Suspense would otherwise swap
          the whole route for a skeleton. */}
      <Suspense fallback={null}>
        <DashboardPage />
      </Suspense>
    </>
  );
}
