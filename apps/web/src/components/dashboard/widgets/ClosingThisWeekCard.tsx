/**
 * dashboard/widgets/ClosingThisWeekCard.tsx — org-wide "bid clock" strip (A1).
 *
 * WHY: the org dashboard had no view of which bids are about to go quiet.
 * This pulls every open opportunity due within 7 days (server-filtered via
 * `dueWithinDays`, see apps/api/src/routes/opportunities.ts) so a lead can
 * spot slippage risk without opening the full pipeline table.
 *
 * Closed deals are excluded client-side (not by the API filter, which is a
 * pure date-window match reused by the "Due ≤ 7d" list chip) — a Closed
 * Won/Lost bid with a stale dueDate inside the window isn't "closing", it's
 * already closed, and showing it here would read as a bug.
 *
 * An empty 7-day window is not a clear week. On the demo book every open bid
 * is already past its close date, so the window returns nothing. That case
 * names those open bids and opens the overdue list instead of saying the
 * week is clear.
 */
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/ui/Icon';
import { DueDateChip, daysUntilDueUtc } from '@/components/ui/DueDateChip';
import { fmtCompact } from '@/components/viz/viz-data';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { useOpportunities } from '@/hooks/useOpportunities';
import { springSoft } from '@/lib/motion';
import type { Opportunity } from '@bidstack/shared';

const CLOSING_WINDOW_DAYS = 7;
const FETCH_LIMIT = 25;
const DISPLAY_LIMIT = 6;

// 44px target. The ring is the focus state. Text stays the primary foreground.
const RETRY =
  'inline-flex min-h-11 items-center justify-center rounded-md px-3 text-xs font-semibold text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]';

function isOpenOpp(o: Opportunity): boolean {
  if (o.pipelineStage) return !o.pipelineStage.isWon && !o.pipelineStage.isLost;
  return o.stage !== 'closed_won' && o.stage !== 'closed_lost';
}

function openByDue(items: Opportunity[] | undefined): Opportunity[] {
  return (items ?? [])
    .filter((opp) => isOpenOpp(opp) && Boolean(opp.dueDate))
    .sort((a, b) => daysUntilDueUtc(a.dueDate ?? '') - daysUntilDueUtc(b.dueDate ?? ''));
}

export function ClosingThisWeekCard() {
  const { t } = useTranslation('crm');
  const { formatMoney } = useFormatMoney();
  const closing = useOpportunities({ dueWithinDays: CLOSING_WINDOW_DAYS, limit: FETCH_LIMIT });
  const pastClose = useOpportunities({ overdue: true, limit: FETCH_LIMIT });

  const items = openByDue(closing.data?.items).slice(0, DISPLAY_LIMIT);
  const pastOpen = openByDue(pastClose.data?.items);
  const weekSettledEmpty = !closing.isLoading && !closing.isError && items.length === 0;
  // A later failure keeps the open bids already on screen. Empty plus loading
  // or error is not a clear week.
  const pastLoading = weekSettledEmpty && pastClose.isLoading && pastOpen.length === 0;
  const pastFailed = weekSettledEmpty && pastClose.isError && pastOpen.length === 0;
  const showPast = weekSettledEmpty && !pastLoading && pastOpen.length > 0;
  const pastCountLabel =
    pastOpen.length === 1
      ? t('closingThisWeek.pastCloseOne', '1 open bid is already past close.')
      : t('closingThisWeek.pastClose', '{{count}} open bids are already past close.', {
          count: pastOpen.length,
        });

  return (
    <GlassCard padding="md" hoverable={false}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--surface-sunken)]">
            <Icon name="clock" size={13} className="text-[var(--tag-teal-fg)]" />
          </div>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('closingThisWeek.heading', 'Closing this week')}
          </h2>
        </div>
        <Link
          to={showPast ? '/opportunities?due=overdue' : '/opportunities?due=within7'}
          className="inline-flex min-h-11 items-center rounded-md px-2 text-xs text-[var(--brand-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] dark:text-[var(--brand-deep)]"
        >
          {showPast
            ? t('closingThisWeek.viewPastClose', 'View past close')
            : t('closingThisWeek.viewAll', 'View all')}
        </Link>
      </div>

      {closing.isLoading || pastLoading ? (
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--surface-sunken)]" />
          ))}
        </div>
      ) : closing.isError ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-sunken)] px-3 py-2.5">
          <span className="text-xs text-[var(--fg-secondary)]">
            {t('closingThisWeek.errorMessage', "Couldn't load bids closing this week.")}
          </span>
          <button
            type="button"
            className="min-h-[44px] rounded-md px-3 text-xs font-semibold text-[var(--brand-primary)] dark:text-[var(--brand-deep)] hover:bg-[var(--surface-hover)]"
            onClick={() => void closing.refetch()}
          >
            {t('closingThisWeek.retry', 'Retry')}
          </button>
        </div>
      ) : pastFailed ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-sunken)] px-3 py-2.5" role="alert">
          <span className="text-xs text-[var(--fg-primary)]">
            {t('closingThisWeek.pastCloseError', "Couldn't load bids that are already past close.")}
          </span>
          <button type="button" className={RETRY} onClick={() => void pastClose.refetch()}>
            {t('closingThisWeek.retry', 'Retry')}
          </button>
        </div>
      ) : showPast ? (
        <div className="space-y-2">
          <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2.5 text-xs text-[var(--fg-secondary)]">
            {t('closingThisWeek.pastCloseWindow', 'No bids are due in the next 7 days.')}
          </p>
          <p className="px-3 text-xs font-medium text-[var(--fg-primary)]">{pastCountLabel}</p>
          <ul className="space-y-1">
            {pastOpen.slice(0, DISPLAY_LIMIT).map((opp) => (
              <li key={opp.id}>
                <Link
                  to={`/opportunities/${opp.id}`}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[var(--fg-primary)]">{opp.name}</div>
                    <div className="truncate text-xs text-[var(--fg-tertiary)]">
                      {opp.customer} · {fmtCompact(opp.value)}
                    </div>
                  </div>
                  <DueDateChip dueDate={opp.dueDate} size="sm" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2.5 text-xs text-[var(--fg-secondary)]">
          {t('closingThisWeek.empty', 'No bids closing this week.')}
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((opp, i) => (
            <motion.li
              key={opp.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...springSoft, delay: i * 0.04 }}
            >
              <Link
                to={`/opportunities/${opp.id}`}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--surface-hover)]"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[var(--fg-primary)]">{opp.name}</div>
                  <div className="truncate text-xs text-[var(--fg-tertiary)]">
                    {opp.customer} · {formatMoney(opp.value, 'EUR')}
                  </div>
                </div>
                <DueDateChip dueDate={opp.dueDate} size="sm" />
              </Link>
            </motion.li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
