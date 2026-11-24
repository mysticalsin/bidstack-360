import '../../styles/org-dashboard.css';

import { lazy, memo, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { LoadingSkeleton } from '@/components/ui/PlainSkeleton';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import { formatMoney } from '@/lib/format';
import { useCurrencyStore } from '@/stores/currency';
import { usePreferences } from '@/stores/preferences';
import type { OrgKpi } from './widgets/dashboard-types';
import { stageColor, stageLabel } from './widgets/dashboard-types';

// Widget modules pull framer-motion. Loading each phase as its own chunk keeps
// that evaluation off the entry task and under the dashboard long-task line.
const GettingStarted = lazy(() =>
  import('./widgets/GettingStarted').then((m) => ({ default: m.GettingStarted })),
);
const KpiRow = lazy(() => import('./widgets/KpiRow').then((m) => ({ default: m.KpiRow })));
const OrgCommandHero = lazy(() =>
  import('./widgets/OrgCommandHero').then((m) => ({ default: m.OrgCommandHero })),
);
const InsightsBar = lazy(() =>
  import('./widgets/InsightsBar').then((m) => ({ default: m.InsightsBar })),
);
const ClosingThisWeekCard = lazy(() =>
  import('./widgets/ClosingThisWeekCard').then((m) => ({ default: m.ClosingThisWeekCard })),
);
const PipelineCard = lazy(() =>
  import('./widgets/PipelineCard').then((m) => ({ default: m.PipelineCard })),
);
const PipelineByStageMini = lazy(() =>
  import('./widgets/PipelineByStageMini').then((m) => ({ default: m.PipelineByStageMini })),
);
const AlertCard = lazy(() => import('./widgets/AlertCard').then((m) => ({ default: m.AlertCard })));
const QuickActionsCard = lazy(() =>
  import('./widgets/SidebarCards').then((m) => ({ default: m.QuickActionsCard })),
);
const QuickLinksCard = lazy(() =>
  import('./widgets/SidebarCards').then((m) => ({ default: m.QuickLinksCard })),
);
const RecentActivityCard = lazy(() =>
  import('./widgets/RecentActivityCard').then((m) => ({ default: m.RecentActivityCard })),
);
const TopAccountsCard = lazy(() =>
  import('./widgets/TopAccountsCard').then((m) => ({ default: m.TopAccountsCard })),
);
const SalesFunnelCard = lazy(() =>
  import('./widgets/SalesFunnelCard').then((m) => ({ default: m.SalesFunnelCard })),
);
const WinRateCard = lazy(() =>
  import('./widgets/WinRateCard').then((m) => ({ default: m.WinRateCard })),
);

function useReducedMotion(): boolean {
  const motionPref = usePreferences((s) => s.motion);
  if (motionPref === 'reduced') return true;
  if (motionPref === 'full') return false;
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Entrance wrapper without framer-motion, so this module stays out of that chunk. */
function Reveal({ children }: { children: ReactNode; delay?: number }) {
  return <>{children}</>;
}

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

  // A brand-new org has no records at all. Sum the core entity counts: when
  // every one is zero, the command center would just read "0 · 0 · 0", so we
  // show a getting-started branch that points at the first real moves instead.
  const isEmptyOrg =
    (s?.companies ?? 0) === 0 &&
    (s?.contacts ?? 0) === 0 &&
    (s?.leads ?? 0) === 0 &&
    (s?.opportunities ?? 0) === 0 &&
    (s?.tasks ?? 0) === 0;

  // Production staggers the widget tree across frames. One commit of the full
  // cockpit was a 300ms+ React task; under Lighthouse's 4x CPU slowdown that
  // single task failed total blocking time. Tests and dev render the full tree
  // immediately so assertions don't depend on animation frames.
  const immediate = !import.meta.env.PROD;
  const ready = !summary.isLoading && !summary.isError && !isEmptyOrg;
  const [phase, setPhase] = useState(immediate ? 3 : 0);
  useEffect(() => {
    if (immediate || !ready || phase >= 3) return;
    const id = window.requestAnimationFrame(() => setPhase((current) => current + 1));
    return () => window.cancelAnimationFrame(id);
  }, [immediate, ready, phase]);

  if (summary.isLoading) return <LoadingSkeleton rows={6} />;
  if (summary.isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center" role="alert">
        <h2 className="text-sm font-semibold text-[var(--danger)]">
          {t('orgDashboard.errorTitle', 'Could not load dashboard')}
        </h2>
        <p className="mt-1 max-w-sm text-xs text-[var(--fg-secondary)]">
          {summary.error?.message ??
            t('orgDashboard.errorMessage', 'The workspace summary endpoint did not respond.')}
        </p>
        <button
          type="button"
          className="btn btn-secondary mt-4"
          onClick={() => void summary.refetch()}
        >
          <Icon name="refresh" size={14} />
          {t('orgDashboard.retry', 'Retry')}
        </button>
      </div>
    );
  }
  if (isEmptyOrg) {
    return (
      <Suspense fallback={<LoadingSkeleton rows={4} />}>
        <GettingStarted />
      </Suspense>
    );
  }

  const showPrimary = phase >= 1;
  const showMain = phase >= 2;
  const showSide = phase >= 3;

  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
    <div className="space-y-5">
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

      {/* Cinematic hero band — ports the account cockpit's command-center
          language to portfolio level (replaces the old flat stat strip). */}
      {s && phase >= 1 && <OrgCommandHero summary={s} />}

      {/* Main cockpit grid. Later phases mount on subsequent frames in
          production so the first commit stays the hero. */}
      <section
        className="cockpit-grid"
        aria-label={t('orgDashboard.cockpitAriaLabel', 'Workspace cockpit')}
      >
        {/* Main column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {showPrimary && (
            <Reveal>
              <KpiRow kpis={kpis} reduced={reduced} />
            </Reveal>
          )}

          {showMain && (
            <>
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
            </>
          )}
        </div>

        {/* Sidebar */}
        <aside
          className="cockpit-side"
          aria-label={t('orgDashboard.detailsAriaLabel', 'Workspace details')}
        >
          {showSide && (
            <>
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
            </>
          )}
        </aside>
      </section>
    </div>
    </Suspense>
  );
});
