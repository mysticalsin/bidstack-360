// "What the agent did" — one opportunity's BidFact ledger, newest first.
//
// Rendered PURELY from BidFact rows. There is no task queue, no dispatcher and
// no run history behind this panel (ROUND2-ULTRAPLAN, "what we are deliberately
// NOT doing"): the ledger is the only record, so the panel is the ledger.
//
// Amber marks a HELD outcome — sources that disagreed and were not averaged.
// Nothing here is ever red: a proposal that was dismissed is a human doing
// their job, not a failure.

import { useContext } from 'react';
import { QueryClientContext, useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { EmptyCellValue } from '@/components/table-kit/empty-cell';
import { SimpleTable, SimpleTableRow } from '@/components/table-kit/simple-table';
import { StatusIndicator, type StatusTone } from '@/components/table-kit/status-indicator';
import { TableCell } from '@/components/table-kit/table';
import type { BidFact, BidFactStatus } from '@/hooks/agent/useBidFacts';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  agentLedgerQueriesPhase,
  type AgentLedgerPhase,
} from './agent-ledger-read';
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

function fallbackPhase(isLoading: boolean, facts: readonly BidFact[]): AgentLedgerPhase {
  if (isLoading && facts.length === 0) return 'unread';
  return 'ready';
}

export function AgentRationaleList(props: AgentRationaleListProps) {
  const client = useContext(QueryClientContext);
  if (!client) return <AgentRationaleBody {...props} phase={fallbackPhase(props.isLoading ?? false, props.facts)} />;
  return <ObservedAgentRationaleList {...props} />;
}

function ObservedAgentRationaleList({
  facts,
  isLoading = false,
  limit = 12,
}: AgentRationaleListProps) {
  const client = useQueryClient();
  // Subscribe so a paused read that later resolves repaints this list.
  useIsFetching({ queryKey: ['bid-facts'] });
  const queries = client.getQueryCache().findAll({ queryKey: ['bid-facts'] });
  // A paused or in-flight read has no payload and isLoading false. That is
  // not an empty ledger, and a failed read does not keep a stale proposal.
  const phase =
    queries.length === 0
      ? fallbackPhase(isLoading, facts)
      : agentLedgerQueriesPhase(
          queries.map((query) => ({
            isError: query.state.status === 'error',
            data: query.state.data,
          })),
        );
  return <AgentRationaleBody facts={facts} limit={limit} phase={phase} />;
}

function AgentRationaleBody({
  facts,
  limit = 12,
  phase,
}: {
  facts: readonly BidFact[];
  limit?: number;
  phase: AgentLedgerPhase;
}) {
  const { t } = useTranslation('rfp');

  if (phase === 'unread') {
    return (
      <p className="p-3 text-xs text-fg-secondary" role="status">
        {t('agent.ledgerChecking', 'Checking what the agent did')}
      </p>
    );
  }

  if (phase === 'error') {
    return (
      <p className="p-3 text-xs text-fg-secondary" role="alert">
        {t('agent.ledgerError', 'Could not load what the agent did')}
      </p>
    );
  }

  const rows = newestFirst(facts).slice(0, limit);

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
