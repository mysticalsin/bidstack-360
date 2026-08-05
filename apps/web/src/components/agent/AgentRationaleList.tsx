// "What the agent did" — one opportunity's BidFact ledger, newest first.
//
// Rendered PURELY from BidFact rows. There is no task queue, no dispatcher and
// no run history behind this panel (ROUND2-ULTRAPLAN, "what we are deliberately
// NOT doing"): the ledger is the only record, so the panel is the ledger.
//
// Amber marks a HELD outcome — sources that disagreed and were not averaged.
// Nothing here is ever red: a proposal that was dismissed is a human doing
// their job, not a failure.

import { useTranslation } from 'react-i18next';

import { EmptyCellValue } from '@/components/table-kit/empty-cell';
import { SimpleTable, SimpleTableRow } from '@/components/table-kit/simple-table';
import { Skeleton } from '@/components/table-kit/skeleton';
import { StatusIndicator, type StatusTone } from '@/components/table-kit/status-indicator';
import { TableCell } from '@/components/table-kit/table';
import type { BidFact, BidFactStatus } from '@/hooks/agent/useBidFacts';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { isHeldFact, newestFirst, rationaleDetail } from './bid-fact-view';

// PROPOSED is the only "waiting on a person" state, so it is the only one that
// gets a colour with any pull. APPLIED reads success; DISMISSED and SUPERSEDED
// are settled history and stay neutral.
const STATUS_TONE: Record<BidFactStatus, StatusTone> = {
  PROPOSED: 'info',
  APPLIED: 'success',
  DISMISSED: 'neutral',
  SUPERSEDED: 'neutral',
};

export interface AgentRationaleListProps {
  facts: readonly BidFact[];
  isLoading?: boolean;
  /** Cap the rows shown; the ledger can be long and this is a side panel. */
  limit?: number;
}

export function AgentRationaleList({
  facts,
  isLoading = false,
  limit = 12,
}: AgentRationaleListProps) {
  const { t } = useTranslation('rfp');

  const rows = newestFirst(facts).slice(0, limit);

  if (isLoading && rows.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-3" aria-busy="true">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="p-3 text-xs text-fg-secondary">
        {t('agent.rationaleEmpty', 'The agent has not proposed anything on this bid yet.')}
      </p>
    );
  }

  return (
    // SimpleTable takes a positional column spec, not arbitrary DOM props, so
    // the accessible name for the whole instrument goes on a labelled region
    // around it rather than on the <table>.
    <section aria-label={t('agent.rationaleListTitle', 'What the agent did')}>
      <SimpleTable
        columns={[
          { header: t('agent.colOutcome', 'Outcome'), width: 'w-32' },
          { header: t('agent.colClaim', 'What it proposed') },
          { header: t('agent.colWhen', 'When'), width: 'w-28', align: 'right' },
        ]}
      >
        {rows.map((fact) => (
          <AgentRationaleRow key={fact.id} fact={fact} />
        ))}
      </SimpleTable>
    </section>
  );
}

function AgentRationaleRow({ fact }: { fact: BidFact }) {
  const { t } = useTranslation('rfp');
  const held = isHeldFact(fact);
  const detail = rationaleDetail(fact);

  return (
    <SimpleTableRow className={cn(held && 'bg-warning-tint')}>
      <TableCell className="px-3 py-2 align-top">
        <StatusIndicator
          size="sm"
          tone={held ? 'warning' : STATUS_TONE[fact.status]}
          label={
            held
              ? t('agent.held', 'Held')
              : t(`agent.status.${fact.status}`, FACT_STATUS_FALLBACK[fact.status])
          }
        />
      </TableCell>
      <TableCell className="px-3 py-2 align-top whitespace-normal">
        <p className="text-xs text-fg-primary">{fact.claim}</p>
        {detail ? (
          <p className={cn('mt-0.5 text-[11px]', held ? 'text-warning' : 'text-fg-secondary')}>
            {detail}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="px-3 py-2 text-right align-top tabular-nums text-fg-secondary">
        {fact.createdAt ? formatDate(fact.createdAt) : <EmptyCellValue />}
      </TableCell>
    </SimpleTableRow>
  );
}

// English fallbacks for the four ledger states, used when a locale tree has not
// been filled in yet — i18next returns the fallback rather than the raw key.
const FACT_STATUS_FALLBACK: Record<BidFactStatus, string> = {
  PROPOSED: 'Proposed',
  APPLIED: 'Applied',
  DISMISSED: 'Dismissed',
  SUPERSEDED: 'Superseded',
};
