/**
 * WorkloadPage — the bid lead's Monday-morning screen (/workload, Workspace
 * section). One glance answers: whose desk is over capacity, who can take the
 * next RFP, which bids are ownerless, and where the week's deadlines land.
 * Data comes from GET /analytics/workload (per-owner aggregates over existing
 * opportunities + tasks); money arrives in micros and is formatted here.
 */
import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import {
  EmptyState,
  EmptyStateLink,
  ErrorState,
  LoadingSkeleton,
} from '@/components/ui/StateMessages';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { useWorkload } from '@/hooks/useWorkload';
import { staggerChild, staggerParent } from '@/lib/motion';

import { teamTotals } from './workload/workloadConfig';
import { WorkloadTable } from './workload/WorkloadTable';

export function WorkloadPage() {
  const { t } = useTranslation('crm');
  const reducedMotion = useReducedMotion();
  const { formatMoneyMicros } = useFormatMoney();
  const workload = useWorkload();

  const owners = useMemo(() => workload.data?.owners ?? [], [workload.data]);
  const totals = useMemo(() => teamTotals(owners), [owners]);
  const hasAnyLoad = owners.some((o) => o.openBids > 0 || o.openTasks > 0);

  const tiles = [
    {
      key: 'bids',
      label: t('workload.totalLiveBids', 'Live bids'),
      value: String(totals.openBids),
      alert: false,
    },
    {
      key: 'weighted',
      label: t('workload.totalWeighted', 'Weighted pipeline'),
      value: formatMoneyMicros(totals.weightedValueMicros.toString()),
      alert: false,
    },
    {
      key: 'over',
      label: t('workload.totalOverCapacity', 'Desks over capacity'),
      value: String(totals.overCapacityDesks),
      alert: totals.overCapacityDesks > 0,
    },
    {
      key: 'unassigned',
      label: t('workload.totalUnassigned', 'Ownerless bids'),
      value: String(totals.unassignedBids),
      alert: totals.unassignedBids > 0,
    },
  ];

  return (
    <motion.div
      className="space-y-6"
      variants={reducedMotion ? undefined : staggerParent}
      initial={reducedMotion ? false : 'initial'}
      animate="animate"
    >
      <motion.header variants={reducedMotion ? undefined : staggerChild}>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--fg-primary)]">
          {t('workload.title', 'Team Workload')}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--fg-secondary)]">
          {t(
            'workload.subtitle',
            "Who's carrying the book into this week — live bids per desk, weighted pipeline, and the deadlines landing in the next seven days.",
          )}
        </p>
      </motion.header>

      <motion.div
        variants={reducedMotion ? undefined : staggerChild}
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        aria-label={t('workload.totalsLabel', 'Team totals')}
      >
        {tiles.map((tile) => (
          <div
            key={tile.key}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3"
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
              {tile.label}
            </div>
            <div
              data-testid={`workload-kpi-${tile.key}`}
              className={`mt-1 text-lg font-bold tabular-nums ${
                tile.alert ? 'text-[var(--danger)]' : 'text-[var(--fg-primary)]'
              }`}
            >
              {tile.value}
            </div>
          </div>
        ))}
      </motion.div>

      <motion.div variants={reducedMotion ? undefined : staggerChild}>
        {workload.isLoading ? (
          <LoadingSkeleton rows={6} />
        ) : workload.isError ? (
          <ErrorState
            title={t('workload.errorTitle', "Couldn't load the team's workload")}
            message={workload.error instanceof Error ? workload.error.message : undefined}
            action={
              <Button size="sm" variant="secondary" onClick={() => void workload.refetch()}>
                {t('workload.retry', 'Try again')}
              </Button>
            }
          />
        ) : !hasAnyLoad ? (
          <EmptyState
            icon="briefcase"
            title={t('workload.emptyTitle', 'No live bids on any desk')}
            message={t(
              'workload.emptyMessage',
              "Once opportunities have owners, this becomes your Monday-morning triage: who's over capacity, who can take the next RFP, and which bids sit ownerless.",
            )}
            secondary={
              <EmptyStateLink to="/opportunities">
                {t('workload.emptyCta', 'Open the pipeline and assign owners')}
              </EmptyStateLink>
            }
          />
        ) : (
          <WorkloadTable owners={owners} formatMoneyMicros={formatMoneyMicros} />
        )}
      </motion.div>
    </motion.div>
  );
}

export default WorkloadPage;
