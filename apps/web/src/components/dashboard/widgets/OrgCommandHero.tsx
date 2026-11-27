/**
 * dashboard/widgets/OrgCommandHero.tsx — cinematic hero band for the org
 * /dashboard (the landing screen after login).
 *
 * WHY: the account cockpit earned a command-center hero (cockpit/CommandCenter)
 * while the org dashboard — the highest-traffic screen — kept a flat stat
 * strip. This ports the cockpit's hero language to portfolio level: one hero
 * metric (open pipeline value, AnimatedNumber count-up) with four supporting
 * signals (open bids, win rate, closing ≤7d, weighted coverage) and a velocity
 * footer. Every number is real data the dashboard already fetches — the
 * pipeline report and the dueWithinDays opportunity query are shared with
 * PipelineByStageMini / ClosingThisWeekCard via React Query key dedupe, so
 * this band costs zero extra network requests.
 *
 * Styling reuses the token-based .command-center classes from index.css, so
 * light/dark parity and the ≤1180px / ≤720px breakpoints come for free.
 */
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { AnimatedNumber } from '@/components/motion/AnimatedNumber';
import { StaggerItem, StaggerList } from '@/components/motion/Stagger';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { useOpportunities } from '@/hooks/useOpportunities';
import type { OrgSummary } from '@/hooks/useOrgSummary';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import { springSnap, springSoft } from '@/lib/motion';
import { formatUnspecifiedAmount, UNSPECIFIED_CURRENCY_BASIS } from '../unspecified-currency';

import type { Opportunity } from '@bidstack/shared';

// Must match ClosingThisWeekCard's filter exactly so React Query serves both
// widgets from a single fetch (object keys are hashed order-independently).
const CLOSING_WINDOW_DAYS = 7;
const CLOSING_FETCH_LIMIT = 25;

type PipelineReportData = NonNullable<ReturnType<typeof usePipelineReport>['data']>;

type PayloadPhase = 'unread' | 'failed' | 'settled';

// A missing payload is unread until the query fails. An arrived payload,
// including a settled empty list, stays settled.
function payloadPhase(query: { data?: unknown; isError?: boolean }): PayloadPhase {
  if (query.data !== undefined && query.data !== null) return 'settled';
  if (query.isError) return 'failed';
  return 'unread';
}

interface HeroSignal {
  key: string;
  label: string;
  display: string;
  detail: string;
  tone: BadgeTone;
  progress: number;
  pending: boolean;
}

// Same open/closed rule as ClosingThisWeekCard: a closed deal with a stale
// dueDate inside the window is already decided — counting it as "closing"
// would read as a bug.
function isOpenOpp(o: Opportunity): boolean {
  if (o.pipelineStage) return !o.pipelineStage.isWon && !o.pipelineStage.isLost;
  return o.stage !== 'closed_won' && o.stage !== 'closed_lost';
}

export function OrgCommandHero({ summary }: { summary: OrgSummary }) {
  const { t } = useTranslation('crm');
  const reduced = useReducedMotion();
  const report = usePipelineReport();
  const closing = useOpportunities({
    dueWithinDays: CLOSING_WINDOW_DAYS,
    limit: CLOSING_FETCH_LIMIT,
  });

  const money = (value: number) => formatUnspecifiedAmount(value);
  const reportPhase = payloadPhase(report);
  const closingPhase = payloadPhase(closing);
  const closingItems =
    closingPhase === 'settled' ? (closing.data?.items ?? []).filter(isOpenOpp) : [];
  const closingValue = closingItems.reduce((acc, opp) => acc + (opp.value ?? 0), 0);
  const winRate = reportPhase === 'settled' ? deriveWinRate(report.data) : null;

  const signals = buildSignals({
    summary,
    report: report.data,
    reportPhase,
    reportPending: reportPhase === 'unread' && report.isLoading,
    winRate,
    closingCount: closingItems.length,
    closingValue,
    closingPhase,
    closingPending: closingPhase === 'unread' && closing.isLoading,
    money,
    t,
  });

  return (
    <motion.section
      className="command-center"
      role="region"
      aria-label={t('orgHero.region.ariaLabel', 'Workspace command center')}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, filter: 'blur(8px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={springSoft}
    >
      <HeroPanel
        summary={summary}
        heroValue={summary.pipelineValue ?? 0}
        formatValue={(n) => formatUnspecifiedAmount(n)}
        winRate={winRate}
        reportPhase={reportPhase}
        closingPhase={closingPhase}
        closingCount={closingItems.length}
        t={t}
      />
      <StaggerList
        className="command-center-metrics"
        aria-label={t('orgHero.signals.ariaLabel', 'Portfolio delivery signals')}
      >
        {signals.map((signal) => (
          <SignalCell key={signal.key} signal={signal} reduced={reduced ?? false} />
        ))}
      </StaggerList>
      <HeroFooter summary={summary} report={report.data} reportPhase={reportPhase} t={t} />
    </motion.section>
  );
}

// ─── Hero panel (left) ───────────────────────────────────────────────────────

interface HeroPanelProps {
  summary: OrgSummary;
  heroValue: number;
  formatValue: (n: number) => string;
  winRate: number | null;
  reportPhase: PayloadPhase;
  closingPhase: PayloadPhase;
  closingCount: number;
  t: TFunction;
}

function HeroPanel({
  summary,
  heroValue,
  formatValue,
  winRate,
  reportPhase,
  closingPhase,
  closingCount,
  t,
}: HeroPanelProps) {
  return (
    <div className="command-center-hero">
      <div className="command-center-orbit" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <div className="command-center-kicker">
        <Icon name="target" size={14} />
        <span>{t('orgHero.kicker', 'Open pipeline, portfolio-wide')}</span>
      </div>
      <h2>
        <AnimatedNumber value={heroValue} format={formatValue} />
      </h2>
      <p className="text-xs text-[var(--fg-tertiary)]">
        {t('orgHero.currencyBasis', UNSPECIFIED_CURRENCY_BASIS)}
      </p>
      <p>{deriveFocusLine(summary, closingCount, closingPhase, t)}</p>
      <div
        className="command-center-actions"
        aria-label={t('orgHero.badges.ariaLabel', 'Portfolio status badges')}
      >
        <Badge tone={summary.openOpportunities > 0 ? 'teal' : 'gray'}>
          {t('orgHero.badge.openBids', '{{count}} open bids', {
            count: summary.openOpportunities,
          })}
        </Badge>
        <Badge tone={reportPhase === 'settled' ? winRateTone(winRate) : 'gray'}>
          {reportPhase === 'unread'
            ? t('orgHero.badge.reportUnread', 'The pipeline report has not arrived.')
            : reportPhase === 'failed'
              ? t('orgHero.badge.reportFailed', 'The pipeline report did not load.')
              : winRate === null
                ? t('orgHero.badge.noClosed', 'No closed bids yet')
                : t('orgHero.badge.winRate', '{{rate}}% win rate', { rate: winRate })}
        </Badge>
        <Badge tone={summary.overdueTasks > 0 ? 'rose' : 'jade'}>
          {t('orgHero.badge.overdue', '{{count}} overdue follow-ups', {
            count: summary.overdueTasks,
          })}
        </Badge>
      </div>
    </div>
  );
}

// The single sentence under the hero number. Mirrors the account cockpit's
// deriveNextMove: always a concrete, data-backed instruction — never generic
// dashboard copy — so the first screen tells the bid lead where to act.
function deriveFocusLine(
  summary: OrgSummary,
  closingCount: number,
  closingPhase: PayloadPhase,
  t: TFunction,
): string {
  if (summary.overdueTasks > 0) {
    return t(
      'orgHero.focus.overdue',
      'Clear {{count}} overdue follow-ups before new bids go out.',
      {
        count: summary.overdueTasks,
      },
    );
  }
  if (closingPhase === 'unread') {
    return t('orgHero.focus.closingUnread', 'The closing list has not arrived.');
  }
  if (closingPhase === 'failed') {
    return t('orgHero.focus.closingFailed', 'The closing list did not load.');
  }
  if (closingCount > 0) {
    return t(
      'orgHero.focus.closing',
      '{{count}} bids close within 7 days — run those reviews first.',
      {
        count: closingCount,
      },
    );
  }
  if (summary.openOpportunities === 0) {
    return t(
      'orgHero.focus.noOpen',
      'No open bids yet. Qualify the next lead to start the pipeline.',
    );
  }
  return t(
    'orgHero.focus.clear',
    'Nothing due this week — runway is clear to advance mid-stage bids.',
  );
}

function winRateTone(rate: number | null): BadgeTone {
  if (rate === null) return 'gray';
  if (rate >= 50) return 'jade';
  if (rate >= 30) return 'blue';
  return 'amber';
}

function deriveWinRate(report: PipelineReportData | undefined): number | null {
  if (!report) return null;
  const won = report.byStage.find((s) => s.stage === 'closed_won')?.count ?? 0;
  const lost = report.byStage.find((s) => s.stage === 'closed_lost')?.count ?? 0;
  const total = won + lost;
  return total > 0 ? Math.round((won / total) * 100) : null;
}

// ─── Supporting signals (right) ──────────────────────────────────────────────

interface SignalInputs {
  summary: OrgSummary;
  report: PipelineReportData | undefined;
  reportPhase: PayloadPhase;
  reportPending: boolean;
  winRate: number | null;
  closingCount: number;
  closingValue: number;
  closingPhase: PayloadPhase;
  closingPending: boolean;
  money: (value: number) => string;
  t: TFunction;
}

function buildSignals(inputs: SignalInputs): HeroSignal[] {
  return [
    openBidsSignal(inputs),
    winRateSignal(inputs),
    closingSignal(inputs),
    weightedSignal(inputs),
  ];
}

function openBidsSignal({ summary, report, t }: SignalInputs): HeroSignal {
  const open = summary.openOpportunities;
  const total = summary.opportunities;
  return {
    key: 'openBids',
    label: t('orgHero.signal.openBids.label', 'Open bids'),
    display: String(open),
    detail: report
      ? t('orgHero.signal.openBids.detail', '{{count}} closed this quarter', {
          count: report.velocity.closedThisQuarter,
        })
      : t('orgHero.signal.openBids.fallback', 'across {{count}} accounts', {
          count: summary.companies,
        }),
    tone: open > 0 ? 'blue' : 'gray',
    progress: total > 0 ? Math.round((open / total) * 100) : 0,
    pending: false,
  };
}

function winRateSignal({
  report,
  reportPhase,
  reportPending,
  winRate,
  t,
}: SignalInputs): HeroSignal {
  const label = t('orgHero.signal.winRate.label', 'Win rate');
  if (reportPhase === 'unread') {
    const unread = t('orgHero.signal.reportUnread', 'The pipeline report has not arrived.');
    return {
      key: 'winRate',
      label,
      display: unread,
      detail: unread,
      tone: 'gray',
      progress: 0,
      pending: reportPending,
    };
  }
  if (reportPhase === 'failed') {
    const failed = t('orgHero.signal.reportFailed', 'The pipeline report did not load.');
    return {
      key: 'winRate',
      label,
      display: failed,
      detail: failed,
      tone: 'gray',
      progress: 0,
      pending: false,
    };
  }
  const won = report?.byStage.find((s) => s.stage === 'closed_won')?.count ?? 0;
  const lost = report?.byStage.find((s) => s.stage === 'closed_lost')?.count ?? 0;
  return {
    key: 'winRate',
    label,
    display: winRate === null ? '—' : `${winRate}%`,
    detail:
      winRate === null
        ? t('orgHero.signal.winRate.empty', 'no closed bids yet')
        : t('orgHero.signal.winRate.detail', '{{won}} won · {{lost}} lost', { won, lost }),
    tone: winRateTone(winRate),
    progress: winRate ?? 0,
    pending: false,
  };
}

function closingSignal(inputs: SignalInputs): HeroSignal {
  const { summary, closingCount, closingValue, closingPhase, closingPending, money, t } = inputs;
  const label = t('orgHero.signal.closing.label', 'Closing within 7 days');
  if (closingPhase === 'unread') {
    const unread = t('orgHero.signal.closing.unread', 'The closing list has not arrived.');
    return {
      key: 'closing',
      label,
      display: unread,
      detail: unread,
      tone: 'gray',
      progress: 0,
      pending: closingPending,
    };
  }
  if (closingPhase === 'failed') {
    const failed = t('orgHero.signal.closing.failedLoad', 'The closing list did not load.');
    return {
      key: 'closing',
      label,
      display: failed,
      detail: failed,
      tone: 'gray',
      progress: 0,
      pending: false,
    };
  }
  const open = Math.max(1, summary.openOpportunities);
  return {
    key: 'closing',
    label,
    display: String(closingCount),
    detail:
      closingCount > 0
        ? t('orgHero.signal.closing.detail', '{{value}} at stake', { value: money(closingValue) })
        : t('orgHero.signal.closing.empty', 'runway clear'),
    tone: closingCount > 0 ? 'amber' : 'jade',
    progress:
      closingCount > 0 ? Math.max(8, Math.min(100, Math.round((closingCount / open) * 100))) : 0,
    pending: false,
  };
}

function weightedSignal({
  report,
  reportPhase,
  reportPending,
  money,
  t,
}: SignalInputs): HeroSignal {
  const label = t('orgHero.signal.weighted.label', 'Weighted pipeline');
  if (reportPhase === 'unread') {
    const unread = t('orgHero.signal.reportUnread', 'The pipeline report has not arrived.');
    return {
      key: 'weighted',
      label,
      display: unread,
      detail: unread,
      tone: 'gray',
      progress: 0,
      pending: reportPending,
    };
  }
  if (reportPhase === 'failed') {
    const failed = t('orgHero.signal.reportFailed', 'The pipeline report did not load.');
    return {
      key: 'weighted',
      label,
      display: failed,
      detail: failed,
      tone: 'gray',
      progress: 0,
      pending: false,
    };
  }
  const coverage =
    report && report.totalValueOpen > 0
      ? Math.round((report.weightedPipeline / report.totalValueOpen) * 100)
      : 0;
  return {
    key: 'weighted',
    label,
    display: report ? money(report.weightedPipeline) : '—',
    detail: report
      ? t('orgHero.signal.weighted.detail', '{{pct}}% of gross open value', { pct: coverage })
      : t('orgHero.signal.winRate.empty', 'no closed bids yet'),
    tone: !report ? 'gray' : coverage >= 60 ? 'jade' : coverage >= 35 ? 'blue' : 'amber',
    progress: coverage,
    pending: false,
  };
}

function SignalCell({ signal, reduced }: { signal: HeroSignal; reduced: boolean }) {
  if (signal.pending) {
    // The sentence stays readable while the skeleton holds the cell's shape.
    // A silent skeleton would leave an in-flight read looking blank.
    return (
      <StaggerItem className="command-signal">
        <div className="command-signal-head">
          <span>{signal.label}</span>
        </div>
        <p role="status">{signal.detail}</p>
        <div aria-hidden>
          <div
            data-testid="signal-skeleton"
            className="h-3 w-24 animate-pulse rounded bg-[var(--surface-sunken)]"
          />
          <div className="mt-4 h-8 w-20 animate-pulse rounded bg-[var(--surface-sunken)]" />
          <div className="mt-4 h-[7px] animate-pulse rounded-full bg-[var(--surface-sunken)]" />
        </div>
      </StaggerItem>
    );
  }
  return (
    <StaggerItem className="command-signal">
      <div className="command-signal-head">
        <span>{signal.label}</span>
        <Badge tone={signal.tone}>{signal.detail}</Badge>
      </div>
      <strong>
        <AnimatedMetric value={signal.display} />
      </strong>
      <span className="command-progress" aria-hidden>
        <motion.span
          initial={{ width: reduced ? `${signal.progress}%` : '0%' }}
          animate={{ width: `${signal.progress}%` }}
          transition={{ ...springSnap, delay: reduced ? 0 : 0.14 }}
        />
      </span>
    </StaggerItem>
  );
}

// ─── Velocity footer ─────────────────────────────────────────────────────────

interface HeroFooterProps {
  summary: OrgSummary;
  report: PipelineReportData | undefined;
  reportPhase: PayloadPhase;
  t: TFunction;
}

function reportGap(phase: PayloadPhase, t: TFunction): string | null {
  if (phase === 'unread')
    return t('orgHero.footer.reportUnread', 'The pipeline report has not arrived.');
  if (phase === 'failed')
    return t('orgHero.footer.reportFailed', 'The pipeline report did not load.');
  return null;
}

function HeroFooter({ summary, report, reportPhase, t }: HeroFooterProps) {
  const gap = reportGap(reportPhase, t);
  return (
    <div className="command-center-footer">
      <div>
        <span>{t('orgHero.footer.velocity.label', 'Avg days a bid stays open')}</span>
        <strong>
          {gap ??
            t('orgHero.footer.velocity.value', '{{count}} days', {
              count: Math.round(report?.velocity.avgDaysOpen ?? 0),
            })}
        </strong>
      </div>
      <div>
        <span>{t('orgHero.footer.closedQuarter.label', 'Closed this quarter')}</span>
        <strong>
          {gap ??
            t('orgHero.footer.closedQuarter.value', '{{count}} bids', {
              count: report?.velocity.closedThisQuarter ?? 0,
            })}
        </strong>
      </div>
      <div>
        <span>{t('orgHero.footer.overdue.label', 'Overdue follow-ups')}</span>
        <strong>
          {t('orgHero.footer.overdue.value', '{{overdue}} of {{total}} tasks', {
            overdue: summary.overdueTasks,
            total: summary.tasks,
          })}
        </strong>
      </div>
    </div>
  );
}
