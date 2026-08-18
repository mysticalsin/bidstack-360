import '../../styles/org-dashboard.css';

import { memo, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { ErrorState } from '@/components/ui/StateMessages';
import { DashboardSkeleton } from '@/components/skeletons/PageSkeletons';
import { Reveal } from '@/components/motion/Reveal';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import { springSoft } from '@/lib/motion';
import { formatMoney } from '@/lib/format';
import { useCurrencyStore } from '@/stores/currency';
import type { OrgKpi } from './widgets/dashboard-types';
import { stageColor, stageLabel } from './widgets/dashboard-types';
import { KpiRow } from './widgets/KpiRow';
import { OrgCommandHero } from './widgets/OrgCommandHero';
import { InsightsBar } from './widgets/InsightsBar';
import { ClosingThisWeekCard } from './widgets/ClosingThisWeekCard';
import { PipelineCard } from './widgets/PipelineCard';
import { PipelineByStageMini } from './widgets/PipelineByStageMini';
import { AlertCard } from './widgets/AlertCard';
import { QuickActionsCard, QuickLinksCard } from './widgets/SidebarCards';
import { RecentActivityCard } from './widgets/RecentActivityCard';
import { TopAccountsCard } from './widgets/TopAccountsCard';
import { SalesFunnelCard } from './widgets/SalesFunnelCard';
import { WinRateCard } from './widgets/WinRateCard';
import { GettingStarted } from './widgets/GettingStarted';

// ─── OrgDashboard ─────────────────────────────────────────────────────────────
// Layout-only orchestrator. Every widget component lives in ./widgets/.

export const OrgDashboard = memo(function OrgDashboard() {
  const { t } = useTranslation('crm');
  const reduced = useReducedMotion();
  const summary = useOrgSummary();
  const pipelineReport = usePipelineReport();
  const { currency, convert } = useCurrencyStore();

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
            <Icon name="refresh" size={14} />
            {t('orgDashboard.retry', 'Retry')}
          </button>
        }
      />
    );
  }
  if (isEmptyOrg) return <GettingStarted />;

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
          <h1 className="page-title gradient-text">
            {t('orgDashboard.pageTitle', 'Workspace Command Center')}
          </h1>
          <div className="page-sub">
            {t(
              'orgDashboard.pageSubtitle',
              '{{companies}} companies · {{openDeals}} open deals · {{pipeline}} pipeline',
              {
                companies: s?.companies ?? 0,
                openDeals: s?.openOpportunities ?? 0,
                pipeline: formatMoney(convert(s?.pipelineValue ?? 0, 'EUR'), currency),
              },
            )}
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

      {/* Cinematic hero band — ports the account cockpit's command-center
          language to portfolio level (replaces the old flat stat strip). */}
      {s && <OrgCommandHero summary={s} />}

      {/* Main cockpit grid */}
      <section
        className="cockpit-grid"
        aria-label={t('orgDashboard.cockpitAriaLabel', 'Workspace cockpit')}
      >
        {/* Main column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Reveal>
            <KpiRow kpis={kpis} reduced={reduced} />
          </Reveal>

          <Reveal delay={0.06}>
            <InsightsBar
              overdueTasks={s?.overdueTasks ?? 0}
              stalledOpps={(s?.opportunities ?? 0) - (s?.openOpportunities ?? 0)}
              newLeads={s?.leads ?? 0}
              pipelineValue={s?.pipelineValue ?? 0}
            />
          </Reveal>

          <Reveal delay={0.07}>
            <ClosingThisWeekCard />
          </Reveal>

          <Reveal delay={0.08}>
            <RecentActivityCard activity={s?.recentActivity ?? []} />
          </Reveal>

          <Reveal delay={0.1}>
            <TopAccountsCard />
          </Reveal>

          <Reveal delay={0.12}>
            <SalesFunnelCard
              leads={s?.leads ?? 0}
              opportunities={s?.opportunities ?? 0}
              openOpps={s?.openOpportunities ?? 0}
              pipelineValue={s?.pipelineValue ?? 0}
              reduced={reduced}
            />
          </Reveal>
        </div>

        {/* Sidebar */}
        <aside
          className="cockpit-side"
          aria-label={t('orgDashboard.detailsAriaLabel', 'Workspace details')}
        >
          <Reveal delay={0.04}>
            <PipelineCard
              value={convert(s?.pipelineValue ?? 0, 'EUR')}
              count={s?.openOpportunities ?? 0}
              currency={currency}
              stages={pipelineStages}
              reduced={reduced}
            />
          </Reveal>

          <Reveal delay={0.06}>
            <PipelineByStageMini
              report={pipelineReport.data}
              reduced={reduced}
              currency={currency}
              convert={convert}
            />
          </Reveal>

          <Reveal delay={0.08}>
            <AlertCard
              tone="rose"
              icon="tasks"
              label={t('orgDashboard.overdueTasks', 'Overdue tasks')}
              value={s?.overdueTasks ?? 0}
              total={s?.tasks ?? 0}
              href="/tasks?filter=overdue"
            />
          </Reveal>

          <Reveal delay={0.1}>
            <QuickActionsCard />
          </Reveal>

          <Reveal delay={0.14}>
            <WinRateCard won={closedWon} lost={closedLost} reduced={reduced} />
          </Reveal>

          <Reveal delay={0.16}>
            <QuickLinksCard />
          </Reveal>
        </aside>
      </section>
    </div>
  );
});
