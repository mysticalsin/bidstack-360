import '../../styles/org-dashboard.css';
import '@/components/viz/viz.css';

import { lazy, memo, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { PoloPreSalesLogo } from '@/components/brand/PoloPreSalesLogo';
import { Icon } from '@/components/ui/Icon';
import { ErrorState } from '@/components/ui/StateMessages';
import { DashboardSkeleton } from '@/components/skeletons/PageSkeletons';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import { useForecastProjection } from '@/hooks/useForecasts';
import { useOpportunityRows } from '@/hooks/useOpportunityRows';
import { useWatchdogFeed } from '@/hooks/useWatchdogFeed';
import { springSoft } from '@/lib/motion';
import {
  recordedPipelineCompact,
  recordedPipelineExact,
  UNSPECIFIED_CURRENCY_BASIS,
} from './unspecified-currency';
import { Tooltip } from '@/components/ui/Tooltip';
import type { OrgKpi } from './widgets/dashboard-types';
import { stageColor, stageLabel } from './widgets/dashboard-types';
import { KpiRow } from './widgets/KpiRow';
import { ClosingThisWeekCard } from './widgets/ClosingThisWeekCard';
import { QuickLinksCard } from './widgets/SidebarCards';
import { RecentActivityCard } from './widgets/RecentActivityCard';
import { DashboardHero, NeedsYou, PerformanceCard, PipelineCard } from './DashboardVisuals';
import { OppDrill, type OppDrillFilter } from '@/components/drill/OppDrill';
import { GettingStarted } from './widgets/GettingStarted';
import { HemaLeverageTile } from './HemaLeverageTile';

// v21: portfolio momentum + top watchdog alerts, its own chunk.
const PortfolioMomentum = lazy(() => import('@/components/signals/PortfolioMomentum'));

// ─── OrgDashboard ─────────────────────────────────────────────────────────────
// Layout-only orchestrator. Every widget component lives in ./widgets/.

export const OrgDashboard = memo(function OrgDashboard() {
  const { t } = useTranslation('crm');
  const reduced = useReducedMotion();
  const summary = useOrgSummary();
  const pipelineReport = usePipelineReport();
  const opps = useOpportunityRows();
  const projection = useForecastProjection();
  const feed = useWatchdogFeed(30);
  const oppRows = useMemo(() => opps.data?.items ?? [], [opps.data?.items]);
  // Progressive disclosure (Tony 15:21): five visuals up top, every number,
  // stage, status and account opens this one drill-down sheet.
  const [drill, setDrill] = useState<OppDrillFilter | null>(null);

  const s = summary.data;
  const closedWon =
    pipelineReport.data?.byStage.find((stage) => stage.stage === 'closed_won')?.count ?? 0;
  const closedLost =
    pipelineReport.data?.byStage.find((stage) => stage.stage === 'closed_lost')?.count ?? 0;
  const pipelineStages = useMemo(
    () => pipelineReport.data?.byStage ?? [],
    [pipelineReport.data?.byStage],
  );

  const kpis: OrgKpi[] = useMemo(() => {
    const companies = s?.companies ?? 0;
    const contacts = s?.contacts ?? 0;
    const leads = s?.leads ?? 0;
    const opportunities = s?.opportunities ?? 0;
    const openOpportunities = s?.openOpportunities ?? 0;
    const tasks = s?.tasks ?? 0;
    const overdueTasks = s?.overdueTasks ?? 0;
    const activeTasks = Math.max(0, tasks - overdueTasks);
    const stageSignals =
      pipelineStages.length > 0
        ? pipelineStages.map((stage) => ({
            label: stageLabel(stage.stage),
            value: stage.count,
            color: stageColor(stage.stage),
          }))
        : [
            {
              label: t('orgDashboard.signalOpenDeals', 'Open deals'),
              value: openOpportunities,
              color: 'var(--tag-teal-fg)',
            },
          ];

    return [
      {
        label: t('orgDashboard.kpiCompaniesLabel', 'Companies'),
        value: companies,
        detail: t('orgDashboard.kpiCompaniesDetail', 'in portfolio'),
        tone: 'blue',
        icon: 'building',
        href: '/companies',
        signal: [
          { label: t('orgDashboard.signalAccounts', 'Accounts'), value: companies, color: 'var(--tag-blue-fg)' },
          { label: t('orgDashboard.signalOpenDeals', 'Open deals'), value: openOpportunities, color: 'var(--tag-teal-fg)' },
        ],
      },
      {
        label: t('orgDashboard.kpiContactsLabel', 'Contacts'),
        value: contacts,
        detail: t('orgDashboard.kpiContactsDetail', 'decision makers'),
        tone: 'jade',
        icon: 'contacts',
        href: '/contacts',
        signal: [
          { label: t('orgDashboard.signalContacts', 'Contacts'), value: contacts, color: 'var(--tag-jade-fg)' },
          { label: t('orgDashboard.signalAccounts', 'Accounts'), value: companies, color: 'var(--tag-blue-fg)' },
          { label: t('orgDashboard.signalLeads', 'Leads'), value: leads, color: 'var(--tag-purple-fg)' },
        ],
      },
      {
        label: t('orgDashboard.kpiLeadsLabel', 'Leads'),
        value: leads,
        detail: t('orgDashboard.kpiLeadsDetail', 'in funnel'),
        tone: 'purple',
        icon: 'user',
        href: '/leads',
        signal: [
          { label: t('orgDashboard.signalLeads', 'Leads'), value: leads, color: 'var(--tag-purple-fg)' },
          { label: t('orgDashboard.signalOpportunities', 'Opportunities'), value: opportunities, color: 'var(--tag-amber-fg)' },
          { label: t('orgDashboard.signalOpenDeals', 'Open deals'), value: openOpportunities, color: 'var(--tag-teal-fg)' },
        ],
      },
      {
        label: t('orgDashboard.kpiOpportunitiesLabel', 'Opportunities'),
        value: opportunities,
        detail: t('orgDashboard.kpiOpportunitiesDetail', 'total bids'),
        tone: 'amber',
        icon: 'briefcase',
        href: '/opportunities',
        signal: [
          { label: t('orgDashboard.signalOpen', 'Open'), value: openOpportunities, color: 'var(--tag-teal-fg)' },
          { label: t('orgDashboard.signalWon', 'Won'), value: closedWon, color: 'var(--tag-jade-fg)' },
          { label: t('orgDashboard.signalLost', 'Lost'), value: closedLost, color: 'var(--tag-rose-fg)' },
        ],
      },
      {
        label: t('orgDashboard.kpiOpenPipelineLabel', 'Open Pipeline'),
        value: openOpportunities,
        detail: t('orgDashboard.kpiOpenPipelineDetail', 'active deals'),
        tone: 'teal',
        icon: 'dollar',
        href: '/opportunities',
        signal: stageSignals,
        // The strip's single accent: open pipeline is the number a sales lead
        // actually steers by — everything else stays neutral ink (KpiRow).
        emphasis: true,
      },
      {
        label: t('orgDashboard.kpiTasksLabel', 'Tasks'),
        value: tasks,
        detail: t('orgDashboard.kpiTasksDetail', 'follow-ups'),
        tone: 'rose',
        icon: 'tasks',
        href: '/tasks',
        signal: [
          { label: t('orgDashboard.signalActive', 'Active'), value: activeTasks, color: 'var(--tag-teal-fg)' },
          { label: t('orgDashboard.signalOverdue', 'Overdue'), value: overdueTasks, color: 'var(--tag-rose-fg)' },
        ],
      },
    ] satisfies OrgKpi[];
  }, [closedLost, closedWon, pipelineStages, s, t]);

  // Compute the greeting once per render instead of calling new Date() three
  // times inline in the JSX below.
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return t('orgDashboard.greetingMorning', 'Good morning');
    if (hour < 18) return t('orgDashboard.greetingAfternoon', 'Good afternoon');
    return t('orgDashboard.greetingEvening', 'Good evening');
  }, [t]);

  // A brand-new org has no records at all. Sum the core entity counts: when
  // every one is zero, the command center would just read "0 · 0 · 0", so we
  // show a getting-started branch that points at the first real moves instead.
  const isEmptyOrg =
    (s?.companies ?? 0) === 0 &&
    (s?.contacts ?? 0) === 0 &&
    (s?.leads ?? 0) === 0 &&
    (s?.opportunities ?? 0) === 0 &&
    (s?.tasks ?? 0) === 0;

  // Exactly one H1 per state: the visible page title in the main view, an
  // sr-only one while loading, on error and in the empty-org state.
  const srTitle = <h1 className="sr-only">{t('orgDashboard.pageTitle', 'Dashboard')}</h1>;
  if (summary.isLoading) return <>{srTitle}<DashboardSkeleton /></>;
  if (summary.isError) {
    return (
      <>
      {srTitle}
      <ErrorState
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
      </>
    );
  }
  if (isEmptyOrg) return <>{srTitle}<GettingStarted /></>;

  return (
    <div className="space-y-5">
      {/* Page head — blur-in spring reveal */}
      <motion.div
        className="page-head motion-page-head"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, filter: 'blur(6px)' }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={springSoft}
      >
        <div>
          <div className="text-xs font-medium text-[var(--brand-primary)] mb-1">{greeting}</div>
          <div className="flex items-center gap-3">
            <PoloPreSalesLogo variant="mark" className="h-8 w-8 shrink-0" />
            <h1 className="page-title">{t('orgDashboard.pageTitle', 'Dashboard')}</h1>
          </div>
          <div className="page-sub">
            {t(
              'orgDashboard.pageSubtitle',
              '{{companies}} companies · {{openDeals}} open deals · {{pipeline}} pipeline',
              {
                companies: s?.companies ?? 0,
                openDeals: s?.openOpportunities ?? 0,
                pipeline: recordedPipelineCompact(s?.pipelineValueMicros, s?.pipelineValue ?? 0),
              },
            )}
            <Tooltip content={`${recordedPipelineExact(s?.pipelineValueMicros, s?.pipelineValue ?? 0)} · ${UNSPECIFIED_CURRENCY_BASIS}`}>
              <button type="button" className="page-sub-info" aria-label={`Pipeline ${recordedPipelineExact(s?.pipelineValueMicros, s?.pipelineValue ?? 0)}: ${UNSPECIFIED_CURRENCY_BASIS}`}>
                <Icon name="info" size={12} />
              </button>
            </Tooltip>
          </div>
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
      </motion.div>

      {/* Five top-level visuals, each with a plain-language caption; depth is
          one click away in the drill sheet or on the account page. */}
      <div className="dash-v" aria-label={t('orgDashboard.cockpitAriaLabel', 'Workspace cockpit')} role="region">
        <div className="viz-grid-3">
          <DashboardHero
            rows={oppRows}
            openValue={pipelineReport.data?.totalValueOpen ?? s?.pipelineValue ?? 0}
            openMicros={pipelineReport.data?.totalValueOpenMicros ?? s?.pipelineValueMicros}
            weighted={pipelineReport.data?.weightedPipeline ?? 0}
            weightedMicros={pipelineReport.data?.weightedPipelineMicros}
            openCount={s?.openOpportunities ?? 0}
            feed={feed.data}
            onDrill={setDrill}
          />
          <NeedsYou overdueTasks={s?.overdueTasks ?? 0} feed={feed.data} />
        </div>
        <Suspense
          fallback={
            <div className="sg viz-grid-3" aria-busy="true">
              <div className="sg-skel" style={{ minHeight: 440 }} />
              <div className="sg-skel" style={{ minHeight: 440 }} />
            </div>
          }
        >
          <PortfolioMomentum />
        </Suspense>
        <HemaLeverageTile />
        <PipelineCard rows={oppRows} onDrill={setDrill} />
        <PerformanceCard rows={oppRows} projection={projection.data} onDrill={setDrill} />
        <OppDrill rows={oppRows} filter={drill} onFilterChange={setDrill} onClose={() => setDrill(null)} />

        <details className="dash-more">
          <summary>{t('orgDashboard.moreDetail', 'Workspace detail')}</summary>
          <div className="dash-more-body">
            <KpiRow kpis={kpis} reduced={reduced} />
            <div className="viz-grid-2">
              <ClosingThisWeekCard />
              <RecentActivityCard activity={s?.recentActivity ?? []} />
            </div>
            <QuickLinksCard />
          </div>
        </details>
      </div>
    </div>
  );
});
