import '../../styles/org-dashboard.css';

import { memo, useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';

import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/StateMessages';
import { CompanyLogo } from '@/components/company/CompanyLogo';
import { DashboardSkeleton } from '@/components/skeletons/PageSkeletons';
import { AnimatedNumber } from '@/components/motion/AnimatedNumber';
import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Reveal } from '@/components/motion/Reveal';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { useCrmDashboard } from '@/hooks/useCrmDashboard';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import { springSoft, springSnap, staggerParent, staggerChild } from '@/lib/motion';
import { formatMoney, relativeTime } from '@/lib/format';
import { useCurrencyStore } from '@/stores/currency';
import type { CrmCompany } from '@bidstack/shared';

// ─── Types ─────────────────────────────────────────────────────────────────

interface OrgKpi {
  label: string;
  value: number;
  detail: string;
  tone: KpiTone;
  icon: string;
  href: string;
  trend?: number; // percent change
  signal: SignalPoint[];
}

type KpiTone = 'blue' | 'jade' | 'purple' | 'amber' | 'teal' | 'rose';

type PipelineStagePoint = { stage: string; count: number; valueSum: number };

type SignalPoint = {
  label: string;
  value: number;
  color?: string;
};

const TONE_BG: Record<KpiTone, string> = {
  blue: 'var(--tag-blue-bg)',
  jade: 'var(--tag-jade-bg)',
  purple: 'var(--tag-purple-bg)',
  amber: 'var(--tag-amber-bg)',
  teal: 'var(--tag-teal-bg)',
  rose: 'var(--tag-rose-bg)',
};

const TONE_FG: Record<KpiTone, string> = {
  blue: 'var(--tag-blue-fg)',
  jade: 'var(--tag-jade-fg)',
  purple: 'var(--tag-purple-fg)',
  amber: 'var(--tag-amber-fg)',
  teal: 'var(--tag-teal-fg)',
  rose: 'var(--tag-rose-fg)',
};

const TONE_GLOW: Record<KpiTone, string> = {
  blue: 'color-mix(in srgb, var(--tag-blue-fg) 18%, transparent)',
  jade: 'color-mix(in srgb, var(--tag-jade-fg) 18%, transparent)',
  purple: 'color-mix(in srgb, var(--tag-purple-fg) 18%, transparent)',
  amber: 'color-mix(in srgb, var(--tag-amber-fg) 18%, transparent)',
  teal: 'color-mix(in srgb, var(--tag-teal-fg) 18%, transparent)',
  rose: 'color-mix(in srgb, var(--tag-rose-fg) 18%, transparent)',
};

const STAGE_COLORS: Record<string, string> = {
  prospecting: 'var(--tag-blue-fg)',
  discovery: 'var(--tag-purple-fg)',
  proposal: 'var(--tag-amber-fg)',
  negotiation: 'var(--tag-teal-fg)',
  closed_won: 'var(--tag-jade-fg)',
  closed_lost: 'var(--tag-rose-fg)',
};

function stageColor(stage: string): string {
  return STAGE_COLORS[stage] ?? 'var(--brand-primary)';
}

function stageLabel(stage: string): string {
  return stage.replace(/_/g, ' ');
}

// ─── Component ─────────────────────────────────────────────────────────────

export const OrgDashboard = memo(function OrgDashboard() {
  const reduced = useReducedMotion();
  const summary = useOrgSummary();
  const dashboard = useCrmDashboard();
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

  const kpis: OrgKpi[] = useMemo(
    () => {
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
      ];
    },
    [closedLost, closedWon, pipelineStages, s],
  );

  const topCompanies = dashboard.data?.companies.slice(0, 5) ?? [];

  // Compute workspace health from available data
  const healthScore = useMemo(() => {
    if (!s) return 78;
    const factors = [
      s.companies > 0 ? 20 : 0,
      s.contacts > 0 ? 15 : 0,
      s.openOpportunities > 0 ? 20 : 0,
      s.overdueTasks === 0 ? 20 : Math.max(0, 20 - s.overdueTasks * 2),
      s.openServiceCases < 5 ? 15 : Math.max(5, 15 - s.openServiceCases),
      s.pipelineValue > 0 ? 10 : 0,
    ];
    return Math.min(
      100,
      factors.reduce((a, b) => a + b, 0),
    );
  }, [s]);

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
            {formatMoney(s?.pipelineValue ?? 0, 'EUR')} pipeline
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

          {/* Insights row */}
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

          {topCompanies.length > 0 && (
            <Reveal delay={0.1}>
              <TopAccountsCard companies={topCompanies} />
            </Reveal>
          )}

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
          <Reveal>
            <WorkspaceHealthCard score={healthScore} reduced={reduced} />
          </Reveal>

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

          <Reveal delay={0.12}>
            <WeeklyGoalCard
              pipelineValue={convert(s?.pipelineValue ?? 0, 'EUR')}
              currency={currency}
            />
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

// ─── KPI Row with trend indicators and glow ────────────────────────────────

function KpiRow({ kpis, reduced }: { kpis: OrgKpi[]; reduced: boolean | null }) {
  return (
    <motion.section
      className="kpi-grid cols-6"
      aria-label="Workspace metrics"
      variants={reduced ? undefined : staggerParent}
      initial="initial"
      animate="animate"
    >
      {kpis.map((kpi, i) => (
        <GlassCard
          key={kpi.label}
          className="flex gap-3 dashboard-kpi-card"
          variants={reduced ? undefined : staggerChild}
          transition={springSnap}
          hoverable
          glow={kpi.tone}
        >
          <Link
            to={kpi.href}
            className="flex gap-3"
            style={{ textDecoration: 'none', color: 'inherit', flex: 1, minWidth: 0 }}
          >
            <div
              className="kpi-icon"
              style={{
                background: TONE_BG[kpi.tone],
                color: TONE_FG[kpi.tone],
                boxShadow: `0 0 16px ${TONE_GLOW[kpi.tone]}`,
              }}
              aria-hidden
            >
              <Icon name={kpi.icon} size={18} />
            </div>
            <div className="kpi-text" style={{ flex: 1, minWidth: 0 }}>
              <div className="kpi-label">{kpi.label}</div>
              <div className="kpi-value" style={{ fontSize: 26, fontWeight: 800 }}>
                <AnimatedNumber
                  value={kpi.value}
                  duration={reduced ? 0 : 0.9}
                  format={(n) => Math.round(n).toLocaleString()}
                />
              </div>
              <div className="kpi-meta">
                {kpi.detail ? <span className="kpi-sub">{kpi.detail}</span> : null}
                {kpi.trend !== undefined && (
                  <span className={`kpi-trend ${kpi.trend >= 0 ? 'trend-up' : 'trend-down'}`}>
                    {kpi.trend >= 0 ? '↑' : '↓'} {Math.abs(kpi.trend)}%
                  </span>
                )}
              </div>
            </div>
            <div
              aria-hidden
              style={{ color: TONE_FG[kpi.tone], alignSelf: 'flex-end', marginBottom: 4 }}
            >
              <KpiSignal points={kpi.signal} tone={kpi.tone} reduced={reduced} delay={i * 0.04} />
            </div>
          </Link>
        </GlassCard>
      ))}
    </motion.section>
  );
}

function KpiSignal({
  points,
  tone,
  reduced,
  delay = 0,
}: {
  points: SignalPoint[];
  tone: KpiTone;
  reduced: boolean | null;
  delay?: number;
}) {
  const visible = points.filter((point) => Number.isFinite(point.value) && point.value > 0).slice(0, 5);

  if (visible.length === 0) {
    return (
      <div className="kpi-signal kpi-signal-empty" title="No live signal yet">
        <span />
        <span />
        <span />
      </div>
    );
  }

  const max = Math.max(...visible.map((point) => point.value), 1);
  const title = visible
    .map((point) => `${point.label}: ${Math.round(point.value).toLocaleString()}`)
    .join(', ');

  return (
    <div className="kpi-signal" title={title}>
      {visible.map((point, index) => {
        const height = Math.max(18, (point.value / max) * 100);
        return (
          <motion.span
            key={`${point.label}-${index}`}
            className="kpi-signal-bar"
            style={
              {
                '--signal-color': point.color ?? TONE_FG[tone],
              } as CSSProperties
            }
            initial={reduced ? { height: `${height}%`, opacity: 1 } : { height: '18%', opacity: 0.45 }}
            animate={{ height: `${height}%`, opacity: 1 }}
            transition={{ ...springSoft, delay: reduced ? 0 : delay + index * 0.045 }}
          />
        );
      })}
    </div>
  );
}

// ─── Insights Bar ──────────────────────────────────────────────────────────

function InsightsBar({
  overdueTasks,
  stalledOpps,
  newLeads,
  pipelineValue,
}: {
  overdueTasks: number;
  stalledOpps: number;
  newLeads: number;
  pipelineValue: number;
}) {
  const insights = [];
  if (overdueTasks > 0) {
    insights.push({
      tone: 'rose' as const,
      icon: 'alert-circle',
      message: `${overdueTasks} task${overdueTasks === 1 ? '' : 's'} overdue`,
      href: '/tasks?filter=overdue',
    });
  }
  if (stalledOpps > 0) {
    insights.push({
      tone: 'amber' as const,
      icon: 'pause-circle',
      message: `${stalledOpps} opportunit${stalledOpps === 1 ? 'y' : 'ies'} stalled`,
      href: '/opportunities',
    });
  }
  if (newLeads > 0) {
    insights.push({
      tone: 'jade' as const,
      icon: 'user-plus',
      message: `${newLeads} new lead${newLeads === 1 ? '' : 's'} this week`,
      href: '/leads',
    });
  }
  if (pipelineValue > 1000000) {
    insights.push({
      tone: 'blue' as const,
      icon: 'trending-up',
      message: `€${(pipelineValue / 1000000).toFixed(1)}M pipeline value`,
      href: '/pipeline',
    });
  }

  if (insights.length === 0) return null;

  return (
    <GlassCard padding="sm" hoverable={false} className="insights-bar">
      <div className="flex items-center gap-2 mb-2">
        <Icon name="zap" size={14} className="text-[var(--brand-primary)]" />
        <span className="text-xs font-semibold text-[var(--fg-primary)]">Priority signals</span>
      </div>
      <div className="insights-grid">
        {insights.map((insight) => (
          <Link
            key={insight.message}
            to={insight.href}
            className={`insight-pill insight-pill-${insight.tone}`}
          >
            <Icon name={insight.icon} size={13} />
            <span>{insight.message}</span>
          </Link>
        ))}
      </div>
    </GlassCard>
  );
}

// ─── Workspace Health Gauge (circular) ─────────────────────────────────────

function WorkspaceHealthCard({ score, reduced }: { score: number; reduced: boolean | null }) {
  const scorePct = Math.max(0, Math.min(100, score)) / 100;
  const band =
    score >= 80 ? 'strong' : score >= 60 ? 'good' : score >= 40 ? 'needs_attention' : 'critical';
  const bandLabel =
    band === 'strong'
      ? 'Excellent'
      : band === 'good'
        ? 'Good'
        : band === 'needs_attention'
          ? 'Needs Attention'
          : 'Critical';
  const bandColor =
    band === 'strong'
      ? 'var(--success)'
      : band === 'good'
        ? 'var(--brand-primary)'
        : band === 'needs_attention'
          ? 'var(--warning)'
          : 'var(--danger)';

  return (
    <GlassCard padding="md" hoverable={false} className="health-gauge-card">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-[var(--fg-primary)]">Workspace Health</span>
        <Badge
          tone={
            band === 'strong'
              ? 'jade'
              : band === 'good'
                ? 'blue'
                : band === 'needs_attention'
                  ? 'amber'
                  : 'tomato'
          }
        >
          {bandLabel}
        </Badge>
      </div>
      <div className="health-gauge-body">
        <div className="health-gauge-visual">
          <svg viewBox="0 0 180 180" aria-hidden>
            <defs>
              <linearGradient id="health-gauge-gradient" x1="20" x2="160" y1="160" y2="20">
                <stop offset="0%" stopColor="var(--danger)" />
                <stop offset="42%" stopColor="var(--warning)" />
                <stop offset="100%" stopColor="var(--success)" />
              </linearGradient>
            </defs>
            <circle className="health-gauge-track" cx="90" cy="90" r="72" pathLength="1" />
            <motion.circle
              className="health-gauge-progress"
              cx="90"
              cy="90"
              r="72"
              pathLength="1"
              initial={{ strokeDashoffset: 1 }}
              animate={{ strokeDashoffset: 1 - scorePct }}
              transition={reduced ? { duration: 0 } : { duration: 1.2, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ stroke: 'url(#health-gauge-gradient)' }}
            />
          </svg>
          <div className="health-gauge-core">
            <span style={{ color: bandColor }}>
              <AnimatedMetric value={score.toString()} />
            </span>
            <small>/100</small>
          </div>
        </div>
        <div className="health-gauge-legend">
          <div className="health-gauge-stat">
            <span>Data quality</span>
            <strong style={{ color: 'var(--success)' }}>Good</strong>
          </div>
          <div className="health-gauge-stat">
            <span>Engagement</span>
            <strong style={{ color: score >= 60 ? 'var(--success)' : 'var(--warning)' }}>
              {Math.round(score * 0.9)}%
            </strong>
          </div>
          <div className="health-gauge-stat">
            <span>Pipeline velocity</span>
            <strong style={{ color: score >= 50 ? 'var(--brand-primary)' : 'var(--warning)' }}>
              {Math.round(score * 0.75)}%
            </strong>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ─── Pipeline Card with sparkline ──────────────────────────────────────────

function PipelineCard({
  value,
  count,
  currency,
  stages,
  reduced,
}: {
  value: number;
  count: number;
  currency: string;
  stages: PipelineStagePoint[];
  reduced: boolean | null;
}) {
  const chartPoints =
    stages.length > 0
      ? stages.map((stage) => ({
          label: stageLabel(stage.stage),
          value: stage.valueSum,
          color: stageColor(stage.stage),
        }))
      : [{ label: 'Open opportunities', value: count, color: 'var(--tag-teal-fg)' }];

  return (
    <GlassCard className="text-center" hoverable={false}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        Open pipeline
      </div>
      <div className="mt-2 text-3xl font-bold tabular-nums text-[var(--fg-primary)]">
        {formatMoney(value, currency)}
      </div>
      <div className="mt-1 text-xs text-[var(--fg-secondary)]">
        {count} open opportunit{count === 1 ? 'y' : 'ies'}
      </div>
      <PipelineLiveChart points={chartPoints} reduced={reduced} />
    </GlassCard>
  );
}

function PipelineLiveChart({
  points,
  reduced,
}: {
  points: SignalPoint[];
  reduced: boolean | null;
}) {
  const visible = points.filter((point) => Number.isFinite(point.value) && point.value > 0);

  if (visible.length === 0) {
    return (
      <div className="pipeline-live-empty">
        <span>No stage value yet</span>
      </div>
    );
  }

  const chartPoints = visible.length === 1 ? [{ ...visible[0]!, value: 0 }, visible[0]!] : visible;
  const width = 168;
  const height = 48;
  const pad = 4;
  const max = Math.max(...chartPoints.map((point) => point.value), 1);
  const min = Math.min(...chartPoints.map((point) => point.value), 0);
  const range = max - min || 1;
  const mapped = chartPoints.map((point, index) => {
    const x = pad + (index / Math.max(chartPoints.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - ((point.value - min) / range) * (height - pad * 2);
    return { ...point, x, y };
  });
  const linePath = smoothLinePath(mapped);
  const first = mapped[0]!;
  const last = mapped[mapped.length - 1]!;
  const fillPath = `${linePath} L ${last.x.toFixed(2)} ${height - pad} L ${first.x.toFixed(2)} ${
    height - pad
  } Z`;

  return (
    <div className="pipeline-live-visual" aria-label="Pipeline stage value distribution">
      <svg viewBox={`0 0 ${width} ${height}`} className="pipeline-live-chart" aria-hidden>
        <defs>
          <linearGradient id="pipeline-live-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--tag-teal-fg)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--tag-teal-fg)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <motion.path
          d={fillPath}
          fill="url(#pipeline-live-fill)"
          initial={reduced ? { opacity: 0.2 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduced ? 0 : 0.5, ease: 'easeOut' }}
        />
        <motion.path
          d={linePath}
          fill="none"
          stroke="var(--tag-teal-fg)"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduced ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0.5 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: reduced ? 0 : 0.9, ease: [0.2, 0.8, 0.2, 1] }}
        />
        {mapped.map((point, index) => (
          <motion.circle
            key={`${point.label}-${index}`}
            cx={point.x}
            cy={point.y}
            r="3"
            fill={point.color ?? 'var(--tag-teal-fg)'}
            initial={reduced ? { scale: 1, opacity: 1 } : { scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...springSoft, delay: reduced ? 0 : 0.25 + index * 0.05 }}
          />
        ))}
      </svg>
      <div className="pipeline-stage-strip" aria-hidden>
        {visible.slice(0, 6).map((point, index) => (
          <motion.span
            key={`${point.label}-${index}`}
            className="pipeline-stage-tick"
            style={{ '--stage-color': point.color ?? 'var(--tag-teal-fg)' } as CSSProperties}
            initial={reduced ? { scaleY: 1 } : { scaleY: 0.35 }}
            animate={{ scaleY: 1 }}
            transition={{ ...springSoft, delay: reduced ? 0 : 0.15 + index * 0.04 }}
            title={`${point.label}: ${Math.round(point.value).toLocaleString()}`}
          />
        ))}
      </div>
    </div>
  );
}

function smoothLinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return rest.reduce((path, point, index) => {
    const previous = points[index]!;
    const midX = (previous.x + point.x) / 2;
    return `${path} C ${midX.toFixed(2)} ${previous.y.toFixed(2)}, ${midX.toFixed(2)} ${point.y.toFixed(
      2,
    )}, ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }, `M ${first!.x.toFixed(2)} ${first!.y.toFixed(2)}`);
}

// ─── Pipeline by Stage Mini ────────────────────────────────────────────────

function PipelineByStageMini({
  report,
  reduced,
  currency,
  convert,
}: {
  report: { byStage: Array<{ stage: string; count: number; valueSum: number }> } | undefined;
  reduced: boolean | null;
  currency: string;
  convert: (amount: number, from: string) => number;
}) {
  if (!report || report.byStage.length === 0) return null;
  const maxValue = Math.max(1, ...report.byStage.map((s) => convert(s.valueSum, 'EUR')));

  return (
    <GlassCard padding="sm" hoverable={false}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)] px-1 pt-1 pb-2">
        Pipeline by stage
      </div>
      <div className="flex flex-col gap-2">
        {report.byStage.map((s, i) => (
          <motion.div
            key={s.stage}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...springSoft, delay: reduced ? 0 : i * 0.045 }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[var(--fg-secondary)] capitalize">
                {stageLabel(s.stage)}
              </span>
              <span className="text-xs font-semibold tabular-nums text-[var(--fg-primary)]">
                {s.count} · {formatMoney(convert(s.valueSum, 'EUR'), currency)}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--surface-sunken)] overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: stageColor(s.stage) }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(4, (s.valueSum / maxValue) * 100)}%` }}
                transition={{ ...springSoft, delay: reduced ? 0 : i * 0.045 + 0.08 }}
              />
            </div>
          </motion.div>
        ))}
      </div>
    </GlassCard>
  );
}

// ─── Alert Card ────────────────────────────────────────────────────────────

function AlertCard({
  tone,
  icon,
  label,
  value,
  total,
  href,
}: {
  tone: KpiTone;
  icon: string;
  label: string;
  value: number;
  total: number;
  href: string;
}) {
  return (
    <GlassCard hoverable={false}>
      <Link
        to={href}
        className="flex items-center gap-3"
        style={{ textDecoration: 'none', color: 'inherit' }}
      >
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{
            background: TONE_BG[tone],
            color: TONE_FG[tone],
            boxShadow: `0 0 12px ${TONE_GLOW[tone]}`,
          }}
        >
          <Icon name={icon} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
            {label}
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-xl font-bold tabular-nums" style={{ color: TONE_FG[tone] }}>
              {value}
            </span>
            <span className="text-xs text-[var(--fg-secondary)]">of {total}</span>
          </div>
        </div>
      </Link>
    </GlassCard>
  );
}

// ─── Quick Actions Card ────────────────────────────────────────────────────

function QuickActionsCard() {
  const actions = [
    { label: 'New lead', href: '/leads/new', icon: 'user-plus', tone: 'purple' as const },
    { label: 'Open tasks', href: '/tasks', icon: 'plus-circle', tone: 'teal' as const },
    { label: 'Contacts', href: '/contacts', icon: 'phone', tone: 'blue' as const },
    { label: 'Companies', href: '/companies', icon: 'building', tone: 'amber' as const },
  ];

  return (
    <GlassCard padding="sm" hoverable={false}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)] px-1 pt-1 pb-2">
        Quick actions
      </div>
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => (
          <Link
            key={action.href}
            to={action.href}
            className="quick-action-btn"
            style={{ '--action-glow': TONE_GLOW[action.tone] } as CSSProperties}
          >
            <Icon name={action.icon} size={14} style={{ color: TONE_FG[action.tone] }} />
            <span>{action.label}</span>
          </Link>
        ))}
      </div>
    </GlassCard>
  );
}

// ─── Quick Links Card ──────────────────────────────────────────────────────

function QuickLinksCard() {
  const links = [
    { label: 'Pipeline', href: '/pipeline', icon: 'briefcase' },
    { label: 'Reports', href: '/reports', icon: 'reports' },
    { label: 'Tasks', href: '/tasks', icon: 'tasks' },
    { label: 'Settings', href: '/settings', icon: 'settings' },
  ];
  return (
    <GlassCard padding="sm" hoverable={false}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)] px-1 pt-1 pb-2">
        Quick links
      </div>
      <div className="grid grid-cols-2 gap-1">
        {links.map((l) => (
          <Link
            key={l.href}
            to={l.href}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] transition-colors"
            style={{ textDecoration: 'none' }}
          >
            <Icon name={l.icon} size={14} />
            {l.label}
          </Link>
        ))}
      </div>
    </GlassCard>
  );
}

// ─── Recent Activity Card ──────────────────────────────────────────────────

function RecentActivityCard({
  activity,
}: {
  activity: Array<{
    type: string;
    title: string;
    subtitle: string | null;
    date: string;
    url: string | null;
  }>;
}) {
  const TYPE_ICONS: Record<string, string> = {
    opportunity: 'briefcase',
    lead: 'user',
    task: 'tasks',
    case: 'life-ring',
  };

  const TYPE_COLORS: Record<string, string> = {
    opportunity: 'var(--tag-amber-bg)',
    lead: 'var(--tag-purple-bg)',
    task: 'var(--tag-teal-bg)',
    case: 'var(--tag-rose-bg)',
  };

  const TYPE_FG: Record<string, string> = {
    opportunity: 'var(--tag-amber-fg)',
    lead: 'var(--tag-purple-fg)',
    task: 'var(--tag-teal-fg)',
    case: 'var(--tag-rose-fg)',
  };

  const visible = activity.slice(0, 8);
  const hasMore = activity.length > 8;

  return (
    <GlassCard padding="none" hoverable={false}>
      <div className="px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--surface-sunken)]">
              <Icon name="activity" size={13} className="text-[var(--brand-primary)]" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Recent activity</h2>
          </div>
          <span className="text-xs text-[var(--fg-tertiary)]">Latest updates</span>
        </div>
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">
        {visible.length === 0 ? (
          <div className="px-5 py-6 text-sm text-[var(--fg-secondary)] text-center">
            No recent activity
          </div>
        ) : (
          visible.map((a, i) => (
            <motion.div
              key={`${a.type}-${a.title}-${a.date}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springSoft, delay: i * 0.032 }}
              className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--surface-hover)] transition-colors"
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: TYPE_COLORS[a.type] ?? 'var(--surface-sunken)',
                  color: TYPE_FG[a.type] ?? 'var(--fg-secondary)',
                }}
              >
                <Icon name={TYPE_ICONS[a.type] ?? 'circle'} size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {a.url ? (
                    <Link
                      to={a.url}
                      className="truncate text-sm font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)]"
                    >
                      {a.title}
                    </Link>
                  ) : (
                    <span className="truncate text-sm font-medium text-[var(--fg-primary)]">
                      {a.title}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--fg-secondary)]">
                  <span className="capitalize">{a.type}</span>
                  {a.subtitle && (
                    <>
                      <span>·</span>
                      <Badge tone="gray">{a.subtitle}</Badge>
                    </>
                  )}
                </div>
              </div>
              <time className="shrink-0 text-xs text-[var(--fg-tertiary)]" dateTime={a.date}>
                {relativeTime(a.date)}
              </time>
            </motion.div>
          ))
        )}
      </div>
      {hasMore && (
        <div className="px-5 py-3 border-t border-[var(--border-subtle)]">
          <Link
            to="/activities"
            className="text-xs font-medium text-[var(--brand-primary)] hover:underline"
          >
            View all {activity.length} activities →
          </Link>
        </div>
      )}
    </GlassCard>
  );
}

// ─── Top Accounts Card ─────────────────────────────────────────────────────

function TopAccountsCard({
  companies,
}: {
  companies: Array<Pick<CrmCompany, 'id' | 'name' | 'industry' | 'domain' | 'logo'>>;
}) {
  return (
    <GlassCard padding="md" hoverable={false}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--surface-sunken)]">
            <Icon name="crown" size={13} className="text-[var(--tag-amber-fg)]" />
          </div>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Top accounts</h2>
        </div>
        <Link to="/accounts" className="text-xs text-[var(--brand-primary)] hover:underline">
          View all
        </Link>
      </div>
      <div className="space-y-1">
        {companies.map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...springSoft, delay: i * 0.04 }}
          >
            <Link
              to={`/accounts/${c.id}`}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--surface-hover)] transition-colors group"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <CompanyLogo name={c.name} logo={c.logo} domain={c.domain} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[var(--fg-primary)]">
                  {c.name}
                </div>
                <div className="truncate text-xs text-[var(--fg-tertiary)]">
                  {c.industry && c.industry !== 'Unknown industry'
                    ? c.industry
                    : c.domain
                      ? c.domain
                      : 'Portfolio account'}
                </div>
              </div>
              <Icon
                name="chevron-right"
                size={14}
                className="text-[var(--fg-tertiary)] group-hover:text-[var(--brand-primary)] transition-colors"
              />
            </Link>
          </motion.div>
        ))}
      </div>
    </GlassCard>
  );
}

// ─── Sales Funnel Visualization ────────────────────────────────────────────

function SalesFunnelCard({
  leads,
  opportunities,
  openOpps,
  pipelineValue,
  reduced,
}: {
  leads: number;
  opportunities: number;
  openOpps: number;
  pipelineValue: number;
  reduced: boolean | null;
}) {
  const stages = [
    { label: 'Leads', count: leads, color: 'var(--tag-purple-fg)', bg: 'var(--tag-purple-bg)' },
    {
      label: 'Opportunities',
      count: opportunities,
      color: 'var(--tag-amber-fg)',
      bg: 'var(--tag-amber-bg)',
    },
    { label: 'Open Deals', count: openOpps, color: 'var(--tag-teal-fg)', bg: 'var(--tag-teal-bg)' },
    {
      label: 'Pipeline',
      count: pipelineValue,
      display: formatMoney(pipelineValue, 'EUR'),
      color: 'var(--tag-jade-fg)',
      bg: 'var(--tag-jade-bg)',
      isMoney: true,
    },
  ];

  // Determine text color based on background brightness
  const getTextColor = (_bgVar: string) => {
    // All tag backgrounds are very light, so use the foreground color
    return 'var(--fg-primary)';
  };

  const maxVal = Math.max(leads, opportunities, openOpps, 1);

  return (
    <GlassCard padding="md" hoverable={false}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--surface-sunken)]">
            <Icon name="filter" size={13} className="text-[var(--brand-primary)]" />
          </div>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Sales funnel</h2>
        </div>
        <Link to="/pipeline" className="text-xs text-[var(--brand-primary)] hover:underline">
          View pipeline
        </Link>
      </div>
      <div className="funnel-viz">
        {stages.map((stage, i) => {
          const widthPct = stage.isMoney ? 100 : Math.max(20, (stage.count / maxVal) * 100);
          return (
            <motion.div
              key={stage.label}
              className="funnel-stage"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springSoft, delay: reduced ? 0 : i * 0.08 }}
            >
              <div className="funnel-stage-bar-outer">
                <motion.div
                  className="funnel-stage-bar"
                  style={{
                    width: `${widthPct}%`,
                    background: stage.bg,
                    color: stage.color,
                  }}
                  initial={reduced ? { width: `${widthPct}%` } : { width: '0%' }}
                  animate={{ width: `${widthPct}%` }}
                  transition={{ ...springSoft, delay: reduced ? 0 : i * 0.08 + 0.1 }}
                >
                  <span
                    className="funnel-stage-label"
                    style={{ color: getTextColor(stage.bg), opacity: 0.75 }}
                  >
                    {stage.label}
                  </span>
                  <span className="funnel-stage-value" style={{ color: getTextColor(stage.bg) }}>
                    {stage.display ?? stage.count.toLocaleString()}
                  </span>
                </motion.div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </GlassCard>
  );
}

// ─── Weekly Goal Card ──────────────────────────────────────────────────────

function WeeklyGoalCard({ pipelineValue, currency }: { pipelineValue: number; currency: string }) {
  const target = 500000; // €500K weekly target
  const progress = Math.min(100, (pipelineValue / target) * 100);
  const remaining = Math.max(0, target - pipelineValue);

  return (
    <GlassCard padding="sm" hoverable={false}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)] px-1 pt-1 pb-2">
        Weekly goal
      </div>
      <div className="flex items-baseline gap-1.5 mb-2">
        <span className="text-xl font-bold tabular-nums text-[var(--fg-primary)]">
          {formatMoney(pipelineValue, currency)}
        </span>
        <span className="text-xs text-[var(--fg-secondary)]">
          of {formatMoney(target, currency)}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-[var(--surface-sunken)] overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{
            background:
              progress >= 100
                ? 'var(--success)'
                : progress >= 50
                  ? 'var(--brand-primary)'
                  : 'var(--warning)',
          }}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ ...springSoft, delay: 0.2 }}
        />
      </div>
      <div className="mt-2 text-xs text-[var(--fg-secondary)]">
        {progress >= 100 ? (
          <span style={{ color: 'var(--success)' }}>🎉 Target reached!</span>
        ) : (
          <>{formatMoney(remaining, currency)} remaining</>
        )}
      </div>
    </GlassCard>
  );
}

// ─── Win Rate Card ─────────────────────────────────────────────────────────

function WinRateCard({
  won,
  lost,
  reduced,
}: {
  won: number;
  lost: number;
  reduced: boolean | null;
}) {
  const total = won + lost;
  const rate = total > 0 ? Math.round((won / total) * 100) : 0;

  return (
    <GlassCard padding="sm" hoverable={false}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)] px-1 pt-1 pb-2">
        Win rate
      </div>
      <div className="flex items-center gap-3">
        {total === 0 ? (
          <div className="flex h-[60px] w-[60px] items-center justify-center rounded-full border border-dashed border-[var(--border-default)] text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
            No closed bids
          </div>
        ) : (
          <div className="win-rate-ring">
            <svg viewBox="0 0 60 60" aria-hidden>
              <circle
                cx="30"
                cy="30"
                r="26"
                fill="none"
                stroke="var(--surface-sunken)"
                strokeWidth="5"
              />
              <motion.circle
                cx="30"
                cy="30"
                r="26"
                fill="none"
                stroke={rate >= 50 ? 'var(--success)' : 'var(--warning)'}
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 26}`}
                initial={{ strokeDashoffset: `${2 * Math.PI * 26}` }}
                animate={{ strokeDashoffset: `${2 * Math.PI * 26 * (1 - rate / 100)}` }}
                transform="rotate(-90 30 30)"
                transition={reduced ? { duration: 0 } : { duration: 1, ease: 'easeOut' }}
              />
            </svg>
            <span
              className="win-rate-text"
              style={{ color: rate >= 50 ? 'var(--success)' : 'var(--warning)' }}
            >
              {rate}%
            </span>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
            <span className="text-[var(--fg-secondary)]">{won} won</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-[var(--tag-rose-fg)]" />
            <span className="text-[var(--fg-secondary)]">{lost} lost</span>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ─── Shared patterns (copied from AccountsPage) ────────────────────────────

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
