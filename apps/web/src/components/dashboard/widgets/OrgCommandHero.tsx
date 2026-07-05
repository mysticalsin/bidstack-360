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
import { formatMoney } from '@/lib/format';
import { springSnap, springSoft } from '@/lib/motion';
import { useCurrencyStore } from '@/stores/currency';

import type { Opportunity } from '@bidstack/shared';

// Must match ClosingThisWeekCard's filter exactly so React Query serves both
// widgets from a single fetch (object keys are hashed order-independently).
const CLOSING_WINDOW_DAYS = 7;
const CLOSING_FETCH_LIMIT = 25;

type PipelineReportData = NonNullable<ReturnType<typeof usePipelineReport>['data']>;

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
  const { currency, convert } = useCurrencyStore();
  const report = usePipelineReport();
  const closing = useOpportunities({ dueWithinDays: CLOSING_WINDOW_DAYS, limit: CLOSING_FETCH_LIMIT });

  const money = (value: number) => formatMoney(convert(value, 'EUR'), currency);
  const closingItems = (closing.data?.items ?? []).filter(isOpenOpp);
  const closingValue = closingItems.reduce((acc, opp) => acc + (opp.value ?? 0), 0);
  const winRate = deriveWinRate(report.data);

  const signals = buildSignals({
    summary,
    report: report.data,
    reportPending: report.isLoading,
    winRate,
    closingCount: closingItems.length,
    closingValue,
    closingPending: closing.isLoading,
    closingFailed: closing.isError,
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
        heroValue={convert(summary.pipelineValue ?? 0, 'EUR')}
        formatValue={(n) => formatMoney(n, currency)}
        winRate={winRate}
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
      <HeroFooter summary={summary} report={report.data} t={t} />
    </motion.section>
  );
}

// ─── Hero panel (left) ───────────────────────────────────────────────────────

interface HeroPanelProps {
  summary: OrgSummary;
  heroValue: number;
  formatValue: (n: number) => string;
  winRate: number | null;
  closingCount: number;
  t: TFunction;
}

function HeroPanel({ summary, heroValue, formatValue, winRate, closingCount, t }: HeroPanelProps) {
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
      <p>{deriveFocusLine(summary, closingCount, t)}</p>
      <div
        className="command-center-actions"
        aria-label={t('orgHero.badges.ariaLabel', 'Portfolio status badges')}
      >
        <Badge tone={summary.openOpportunities > 0 ? 'teal' : 'gray'}>
          {t('orgHero.badge.openBids', '{{count}} open bids', {
            count: summary.openOpportunities,
          })}
        </Badge>
        <Badge tone={winRateTone(winRate)}>
          {winRate === null
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
function deriveFocusLine(summary: OrgSummary, closingCount: number, t: TFunction): string {
  if (summary.overdueTasks > 0) {
    return t('orgHero.focus.overdue', 'Clear {{count}} overdue follow-ups before new bids go out.', {
      count: summary.overdueTasks,
    });
  }
  if (closingCount > 0) {
    return t('orgHero.focus.closing', '{{count}} bids close within 7 days — run those reviews first.', {
      count: closingCount,
    });
  }
  if (summary.openOpportunities === 0) {
    return t('orgHero.focus.noOpen', 'No open bids yet. Qualify the next lead to start the pipeline.');
  }
  return t('orgHero.focus.clear', 'Nothing due this week — runway is clear to advance mid-stage bids.');
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
  reportPending: boolean;
  winRate: number | null;
  closingCount: number;
  closingValue: number;
  closingPending: boolean;
  closingFailed: boolean;
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

function winRateSignal({ report, reportPending, winRate, t }: SignalInputs): HeroSignal {
  const won = report?.byStage.find((s) => s.stage === 'closed_won')?.count ?? 0;
  const lost = report?.byStage.find((s) => s.stage === 'closed_lost')?.count ?? 0;
  return {
    key: 'winRate',
    label: t('orgHero.signal.winRate.label', 'Win rate'),
    display: winRate === null ? '—' : `${winRate}%`,
    detail: !report
      ? t('orgHero.signal.unavailable', 'report unavailable')
      : winRate === null
        ? t('orgHero.signal.winRate.empty', 'no closed bids yet')
        : t('orgHero.signal.winRate.detail', '{{won}} won · {{lost}} lost', { won, lost }),
    tone: winRateTone(winRate),
    progress: winRate ?? 0,
    pending: reportPending,
  };
}

function closingSignal(inputs: SignalInputs): HeroSignal {
  const { summary, closingCount, closingValue, closingPending, closingFailed, money, t } = inputs;
  const open = Math.max(1, summary.openOpportunities);
  return {
    key: 'closing',
    label: t('orgHero.signal.closing.label', 'Closing within 7 days'),
    display: closingFailed ? '—' : String(closingCount),
    detail: closingFailed
      ? t('orgHero.signal.closing.failed', 'due list unavailable')
      : closingCount > 0
        ? t('orgHero.signal.closing.detail', '{{value}} at stake', { value: money(closingValue) })
        : t('orgHero.signal.closing.empty', 'runway clear'),
    tone: closingFailed ? 'gray' : closingCount > 0 ? 'amber' : 'jade',
    progress:
      closingCount > 0 ? Math.max(8, Math.min(100, Math.round((closingCount / open) * 100))) : 0,
    pending: closingPending,
  };
}

function weightedSignal({ report, reportPending, money, t }: SignalInputs): HeroSignal {
  const coverage =
    report && report.totalValueOpen > 0
      ? Math.round((report.weightedPipeline / report.totalValueOpen) * 100)
      : 0;
  return {
    key: 'weighted',
    label: t('orgHero.signal.weighted.label', 'Weighted pipeline'),
    display: report ? money(report.weightedPipeline) : '—',
    detail: report
      ? t('orgHero.signal.weighted.detail', '{{pct}}% of gross open value', { pct: coverage })
      : t('orgHero.signal.unavailable', 'report unavailable'),
    tone: !report ? 'gray' : coverage >= 60 ? 'jade' : coverage >= 35 ? 'blue' : 'amber',
    progress: coverage,
    pending: reportPending,
  };
}

function SignalCell({ signal, reduced }: { signal: HeroSignal; reduced: boolean }) {
  if (signal.pending) {
    // Layout-matched skeleton (label, value, progress bar) — not a spinner —
    // so the cell loads "in place" per the PageSkeletons doctrine.
    return (
      <StaggerItem className="command-signal" aria-hidden>
        <div data-testid="signal-skeleton" className="h-3 w-24 animate-pulse rounded bg-[var(--surface-sunken)]" />
        <div className="mt-4 h-8 w-20 animate-pulse rounded bg-[var(--surface-sunken)]" />
        <div className="mt-4 h-[7px] animate-pulse rounded-full bg-[var(--surface-sunken)]" />
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
  t: TFunction;
}

function HeroFooter({ summary, report, t }: HeroFooterProps) {
  return (
    <div className="command-center-footer">
      <div>
        <span>{t('orgHero.footer.velocity.label', 'Avg days a bid stays open')}</span>
        <strong>
          {report
            ? t('orgHero.footer.velocity.value', '{{count}} days', {
                count: Math.round(report.velocity.avgDaysOpen),
              })
            : '—'}
        </strong>
      </div>
      <div>
        <span>{t('orgHero.footer.closedQuarter.label', 'Closed this quarter')}</span>
        <strong>
          {report
            ? t('orgHero.footer.closedQuarter.value', '{{count}} bids', {
                count: report.velocity.closedThisQuarter,
              })
            : '—'}
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
