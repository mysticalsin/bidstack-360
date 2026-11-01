/**
 * dashboard/widgets/ClosingThisWeekCard.tsx — org-wide "bid clock" strip (A1).
 *
 * WHY: the org dashboard had no view of which bids are about to go quiet.
 * This pulls every open opportunity due within 7 days (server-filtered via
 * `dueWithinDays`, see apps/api/src/routes/opportunities.ts) so a lead can
 * spot slippage risk without opening the full pipeline table.
 *
 * The request asks the server to leave decided stages out. A page of lost
 * deals would otherwise fill the 25-row window and hide an open bid. The
 * Due ≤ 7d list chip still uses the date window without that flag. The
 * client filter remains so a stale cached row cannot appear as closing.
 */
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/ui/Icon';
import { DueDateChip, daysUntilDueUtc } from '@/components/ui/DueDateChip';
import { useOpportunities } from '@/hooks/useOpportunities';
import { springSoft } from '@/lib/motion';
import type { Opportunity } from '@bidstack/shared';

import { closedOutcome } from '@/lib/pipeline-stages';

import { formatRecordedDealAmount } from '../unspecified-currency';

const CLOSING_WINDOW_DAYS = 7;
const DISPLAY_LIMIT = 6;

function isOpenOpp(o: Opportunity): boolean {
  return closedOutcome(o) === null;
}

export function ClosingThisWeekCard() {
  const { t } = useTranslation('crm');
  const closing = useOpportunities({
    dueWithinDays: CLOSING_WINDOW_DAYS,
    excludeClosed: true,
    limit: 25,
  });

  const openItems = (closing.data?.items ?? [])
    .filter(isOpenOpp)
    .sort((a, b) => daysUntilDueUtc(a.dueDate ?? '') - daysUntilDueUtc(b.dueDate ?? ''));
  const items = openItems.slice(0, DISPLAY_LIMIT);
  const moreBeyond = Boolean(closing.data?.nextCursor);
  const listNote = moreBeyond
    ? t('closingThisWeek.moreBeyond', 'Showing {{shown}} soonest. More bids close this week.', {
        shown: items.length,
      })
    : openItems.length > items.length
      ? t('closingThisWeek.showingPage', 'Showing {{shown}} of {{total}}.', {
          shown: items.length,
          total: openItems.length,
        })
      : null;

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
          to="/opportunities?due=within7"
          className="text-xs text-[var(--brand-primary)] hover:underline"
        >
          {t('closingThisWeek.viewAll', 'View all')}
        </Link>
      </div>

      {closing.isLoading ? (
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
            className="min-h-[44px] rounded-md px-3 text-xs font-semibold text-[var(--brand-primary)] hover:bg-[var(--surface-hover)]"
            onClick={() => void closing.refetch()}
          >
            {t('closingThisWeek.retry', 'Retry')}
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2.5 text-xs text-[var(--fg-secondary)]">
          {moreBeyond
            ? t('closingThisWeek.emptyBeyond', 'More bids close this week than this page shows.')
            : t('closingThisWeek.empty', 'No bids closing this week.')}
        </p>
      ) : (
        <>
        {listNote ? <p className="mb-2 text-xs text-[var(--fg-secondary)]">{listNote}</p> : null}
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
                  <div className="truncate text-sm font-medium text-[var(--fg-primary)]">
                    {opp.name}
                  </div>
                  <div className="truncate text-xs text-[var(--fg-tertiary)]">
                    {opp.customer} · {formatRecordedDealAmount(opp)}
                  </div>
                </div>
                <DueDateChip dueDate={opp.dueDate} size="sm" />
              </Link>
            </motion.li>
          ))}
        </ul>
        </>
      )}
    </GlassCard>
  );
}
