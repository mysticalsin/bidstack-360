import '../../styles/org-dashboard.css';

import { memo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { ErrorState } from '@/components/ui/StateMessages';
import { DashboardSkeleton } from '@/components/skeletons/PageSkeletons';
import { useOrgSummary, type OrgSummary } from '@/hooks/useOrgSummary';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import { ClosingThisWeekCard } from './widgets/ClosingThisWeekCard';
import { PipelineByStageMini } from './widgets/PipelineByStageMini';
import { PipelineMetricStrip } from './widgets/PipelineMetricStrip';
import { AlertCard } from './widgets/AlertCard';
import { RecentActivityCard } from './widgets/RecentActivityCard';
import { TopAccountsCard } from './widgets/TopAccountsCard';
import { GettingStarted } from './widgets/GettingStarted';

// One title, one pipeline figure, one next action. The old hero, six KPI
// cards, and funnel all repeated the same counts.
export const OrgDashboard = memo(function OrgDashboard() {
  const { t } = useTranslation('crm');
  const summary = useOrgSummary();
  const pipelineReport = usePipelineReport();

  const s = summary.data;

  const isEmptyOrg =
    (s?.companies ?? 0) === 0 &&
    (s?.contacts ?? 0) === 0 &&
    (s?.leads ?? 0) === 0 &&
    (s?.opportunities ?? 0) === 0 &&
    (s?.tasks ?? 0) === 0;

  if (summary.isLoading) return <DashboardSkeleton />;
  if (summary.isError) {
    return (
      <ErrorState
        title={t('orgDashboard.errorTitle', 'Could not load dashboard')}
        message={
          summary.error?.message ??
          t('orgDashboard.errorMessage', 'The workspace summary endpoint did not respond.')
        }
        action={
          <button type="button" className="btn btn-secondary" onClick={() => void summary.refetch()}>
            {t('orgDashboard.retry', 'Retry')}
          </button>
        }
      />
    );
  }
  if (isEmptyOrg || !s) return <GettingStarted />;

  const next = nextAction(s, t);

  return (
    <div className="space-y-8">
      <header className="page-head">
        <div>
          <h1 className="page-title">{t('orgDashboard.pageTitle', 'Pipeline')}</h1>
          <p className="page-sub">
            {t('orgDashboard.pageSubtitle', '{{companies}} companies · {{openDeals}} open deals', {
              companies: s.companies,
              openDeals: s.openOpportunities,
            })}
          </p>
        </div>
        <div className="page-actions">
          <Link to={next.href} className="btn btn-primary">
            {next.label}
          </Link>
        </div>
      </header>

      <PipelineMetricStrip stages={pipelineReport.data?.byStage} loading={pipelineReport.isLoading} />

      <PipelineByStageMini report={pipelineReport.data} />

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <ClosingThisWeekCard />
          <TopAccountsCard />
        </div>
        <aside className="flex min-w-0 flex-col gap-6" aria-label={t('orgDashboard.detailsAriaLabel', 'Workspace details')}>
          <AlertCard
            tone="rose"
            icon="tasks"
            label={t('orgDashboard.overdueTasks', 'Overdue tasks')}
            value={s.overdueTasks}
            total={s.tasks}
            href="/tasks?filter=overdue"
          />
          <RecentActivityCard activity={s.recentActivity} />
        </aside>
      </div>
    </div>
  );
});

function nextAction(summary: OrgSummary, t: TFunction): { href: string; label: string } {
  if (summary.overdueTasks > 0) {
    return {
      href: '/tasks?filter=overdue',
      label: t('orgDashboard.nextOverdue', 'Review overdue tasks'),
    };
  }
  if (summary.openOpportunities > 0) {
    return {
      href: '/opportunities',
      label: t('orgDashboard.nextDeals', 'Review open deals'),
    };
  }
  return {
    href: '/accounts',
    label: t('orgDashboard.nextAccounts', 'Open accounts'),
  };
}
