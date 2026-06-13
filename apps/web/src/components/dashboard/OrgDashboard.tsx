import '../../styles/org-dashboard.css';

import { memo, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';

import { Icon } from '@/components/ui/Icon';
import { ErrorState } from '@/components/ui/StateMessages';
import { DashboardSkeleton } from '@/components/skeletons/PageSkeletons';
import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Reveal } from '@/components/motion/Reveal';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import { springSoft } from '@/lib/motion';
import { formatMoney } from '@/lib/format';
import { useCurrencyStore } from '@/stores/currency';
import type { OrgKpi } from './widgets/dashboard-types';
import { stageColor, stageLabel } from './widgets/dashboard-types';
import { KpiRow } from './widgets/KpiRow';
import { InsightsBar } from './widgets/InsightsBar';
import { PipelineCard } from './widgets/PipelineCard';
import { PipelineByStageMini } from './widgets/PipelineByStageMini';
import { AlertCard } from './widgets/AlertCard';
import { QuickActionsCard, QuickLinksCard } from './widgets/SidebarCards';
import { RecentActivityCard } from './widgets/RecentActivityCard';
import { TopAccountsCard } from './widgets/TopAccountsCard';
import { SalesFunnelCard } from './widgets/SalesFunnelCard';
import { WinRateCard } from './widgets/WinRateCard';

// ─── OrgDashboard ─────────────────────────────────────────────────────────────
// Layout-only orchestrator. Every widget component lives in ./widgets/.

export const OrgDashboard = memo(function OrgDashboard() {
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
    const openServiceCases = s?.openServiceCases ?? 0;
    const activeTasks = Math.max(0, tasks - overdueTasks);
    const stageSignals =
      pipelineStages.length > 0
        ? pipelineStages.map((stage) => ({
            label: stageLabel(stage.stage),
            value: stage.count,
            color: stageColor(stage.stage),
          }))
        : [{ label: 'Open deals', value: openOpportunities, color: 'var(--tag-teal-fg)' }];

    return [
      {
        label: 'Companies',
        value: companies,
        detail: 'in portfolio',
        tone: 'blue',
        icon: 'building',
        href: '/companies',
        signal: [
          { label: 'Accounts', value: companies, color: 'var(--tag-blue-fg)' },
          { label: 'Open deals', value: openOpportunities, color: 'var(--tag-teal-fg)' },
          { label: 'Cases', value: openServiceCases, color: 'var(--tag-rose-fg)' },
        ],
      },
      {
        label: 'Contacts',
        value: contacts,
        detail: 'decision makers',
        tone: 'jade',
        icon: 'contacts',
        href: '/contacts',
        signal: [
          { label: 'Contacts', value: contacts, color: 'var(--tag-jade-fg)' },
          { label: 'Accounts', value: companies, color: 'var(--tag-blue-fg)' },
          { label: 'Leads', value: leads, color: 'var(--tag-purple-fg)' },
        ],
      },
      {
        label: 'Leads',
        value: leads,
        detail: 'in funnel',
        tone: 'purple',
        icon: 'user',
        href: '/leads',
        signal: [
          { label: 'Leads', value: leads, color: 'var(--tag-purple-fg)' },
          { label: 'Opportunities', value: opportunities, color: 'var(--tag-amber-fg)' },
          { label: 'Open deals', value: openOpportunities, color: 'var(--tag-teal-fg)' },
        ],
      },
      {
        label: 'Opportunities',
        value: opportunities,
        detail: 'total bids',
        tone: 'amber',
        icon: 'briefcase',
        href: '/opportunities',
        signal: [
          { label: 'Open', value: openOpportunities, color: 'var(--tag-teal-fg)' },
          { label: 'Won', value: closedWon, color: 'var(--tag-jade-fg)' },
          { label: 'Lost', value: closedLost, color: 'var(--tag-rose-fg)' },
        ],
      },
      {
        label: 'Open Pipeline',
        value: openOpportunities,
        detail: 'active deals',
        tone: 'teal',
        icon: 'dollar',
        href: '/opportunities',
        signal: stageSignals,
      },
      {
        label: 'Tasks',
        value: tasks,
        detail: 'follow-ups',
        tone: 'rose',
        icon: 'tasks',
        href: '/tasks',
        signal: [
          { label: 'Active', value: activeTasks, color: 'var(--tag-teal-fg)' },
          { label: 'Overdue', value: overdueTasks, color: 'var(--tag-rose-fg)' },
          { label: 'Cases', value: openServiceCases, color: 'var(--tag-amber-fg)' },
        ],
      },
    ] satisfies OrgKpi[];
  }, [closedLost, closedWon, pipelineStages, s]);

  if (summary.isLoading) return <DashboardSkeleton />;
  if (summary.isError) {
    return (
      <ErrorState
        title="Could not load dashboard"
        message={summary.error?.message ?? 'The workspace summary endpoint did not respond.'}
      />
    );
  }

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
          <div className="text-xs font-medium text-[var(--brand-primary)] mb-1">
            {new Date().getHours() < 12
              ? 'Good morning'
              : new Date().getHours() < 18
                ? 'Good afternoon'
                : 'Good evening'}
          </div>
          <h1 className="page-title gradient-text">Workspace Command Center</h1>
          <div className="page-sub">
            {s?.companies ?? 0} companies · {s?.openOpportunities ?? 0} open deals ·{' '}
            {formatMoney(convert(s?.pipelineValue ?? 0, 'EUR'), currency)} pipeline
          </div>
        </div>
        <div className="page-actions">
          <Link to="/accounts" className="btn btn-secondary">
            <Icon name="building" size={14} />
            All accounts
          </Link>
          <Link to="/opportunities" className="btn btn-primary">
            <Icon name="plus" size={14} />
            Opportunities
          </Link>
        </div>
      </motion.div>

      {/* Source stat strip with animated metrics */}
      <section className="account-dashboard-strip" aria-label="Workspace metrics">
        <SourceStat label="Accounts" value={String(s?.companies ?? 0)} detail="portfolio" />
        <SourceStat label="Contacts" value={String(s?.contacts ?? 0)} detail="people" />
        <SourceStat
          label="Open Deals"
          value={String(s?.openOpportunities ?? 0)}
          detail="pipeline"
        />
        <SourceStat
          label="Pipeline"
          value={formatMoney(convert(s?.pipelineValue ?? 0, 'EUR'), currency)}
          detail="weighted"
        />
        <SourceStat label="Overdue" value={String(s?.overdueTasks ?? 0)} detail="tasks" />
        <SourceStat label="Cases" value={String(s?.openServiceCases ?? 0)} detail="open" />
      </section>

      {/* Main cockpit grid */}
      <section className="cockpit-grid" aria-label="Workspace cockpit">
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
        <aside className="cockpit-side" aria-label="Workspace details">
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
              label="Overdue tasks"
              value={s?.overdueTasks ?? 0}
              total={s?.tasks ?? 0}
              href="/tasks?filter=overdue"
            />
          </Reveal>

          <Reveal delay={0.1}>
            <AlertCard
              tone="amber"
              icon="life-ring"
              label="Open cases"
              value={s?.openServiceCases ?? 0}
              total={s?.serviceCases ?? 0}
              href="/service-desk"
            />
          </Reveal>

          <Reveal delay={0.12}>
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

// ─── SourceStat ───────────────────────────────────────────────────────────────
// Tiny metric tile used only in the strip above — too small to warrant its own file.

function SourceStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="account-source-stat">
      <span>{label}</span>
      <strong>
        <AnimatedMetric value={value} />
      </strong>
      <small>{detail}</small>
    </div>
  );
}
