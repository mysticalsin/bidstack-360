// The Compliance Matrix, retargeted to table-kit density — the money screen.
//
// WHAT CHANGED FROM THE PLAN, LOUDLY: ROUND2-ULTRAPLAN describes this file as
// "93 lines, purely presentational — props from RfpPipelinePage". It is not and
// never was. It takes NO props: it reads `bidWorkspaceId` from the rfpPipeline
// zustand store and calls `useRfpCompliance` itself (RfpPipelinePage.tsx:175
// mounts it as a bare `<ComplianceMatrix />`). Rather than invert that ownership
// mid-round — which would drag RfpPipelinePage, its store and its tests into a
// component change — the self-fetching shape is kept and the density retarget is
// done inside it. Following the code, not the plan.
//
// The three slots per row (value | provenance | suggestion) live in
// ComplianceRow; this file owns the instrument around them: URL state, facets,
// sorting, paging, and ONE fact fan-out for the visible page.
//
// Paging is client-side because the API hands back the whole matrix in one
// response (bid-workspace.ts:141, `take: 500`). That is not a workaround — it is
// what bounds the BidFact fan-out to 25 rows per screen (useBidFacts.ts).

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AgentRationaleList } from '@/components/agent/AgentRationaleList';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/table-kit/table';
import { TablePagination } from '@/components/table-kit/table-pagination';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';
import {
  useDecideBidFact,
  useSubjectBidFacts,
  subjectFactsFor,
  type BidFact,
  type SubjectFacts,
} from '@/hooks/agent/useBidFacts';
import {
  useRfpCompliance,
  useSaveComplianceRow,
  type ComplianceRow as ComplianceRowData,
} from '@/hooks/rfp/useRfpCompliance';
import { cn } from '@/lib/cn';
import { useTableQuery, type ListTableQueryState } from '@/lib/table/use-table-query';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';

import { ComplianceMatrixToolbar } from './ComplianceMatrixToolbar';
import { ComplianceRow } from './ComplianceRow';
import {
  ALL,
  filterComplianceRows,
  pageOfRows,
  sectionOptions,
  sortComplianceRows,
  statusCounts,
} from './compliance-matrix-rows';
import { COMPLIANCE_STATUSES, complianceMatrixSearchParams } from './compliance-matrix-search-params';

const COLUMN_COUNT = 5;

const STATUS_FALLBACK: Record<string, string> = {
  compliant: 'Compliant',
  partial: 'Partial',
  non_compliant: 'Non-compliant',
  pending: 'Pending',
};

export function ComplianceMatrix() {
  const bidWorkspaceId = useRfpPipelineStore((s) => s.bidWorkspaceId);
  const { data, isLoading, isError, error } = useRfpCompliance(bidWorkspaceId);
  const saveRow = useSaveComplianceRow(bidWorkspaceId);
  const { query } = useTableQuery(complianceMatrixSearchParams);

  const allRows = data?.items ?? [];
  const visible = sortComplianceRows(
    filterComplianceRows(allRows, {
      status: query.tab,
      section: query.filters.section ?? ALL,
      mandatory: query.filters.mandatory ?? ALL,
      q: query.q,
    }),
    query.sort,
    query.dir,
  );
  const pageRows = pageOfRows(visible, query.page, query.pageSize);

  // One fan-out for the page: PROPOSED for every visible row, plus APPLIED for
  // the rows that already show an answer — the only rows whose value can carry
  // a receipt.
  const facts = useSubjectBidFacts(
    'matrix_row',
    pageRows.map((row) => ({ subjectId: row.id, wantApplied: !!row.response })),
  );
  const decide = useDecideBidFact({ subjectType: 'matrix_row', workspaceId: bidWorkspaceId });

  const settled = !isLoading && !isError;

  return (
    <Card>
      <MatrixHeader data={data} allRows={allRows} query={query} />
      <MatrixFetchStates
        isLoading={isLoading}
        isError={isError}
        error={error}
        isEmpty={settled && allRows.length === 0}
      />
      {settled && allRows.length > 0 && (
        <div className="flex flex-col gap-3 p-3">
          <MatrixTable
            rows={pageRows}
            factsFor={(rowId) => subjectFactsFor(facts.bySubject, rowId)}
            query={query}
            onSave={(rowId, answerDraft) => saveRow.mutate({ rowId, answerDraft })}
            isSaving={saveRow.isPending}
            decide={decide}
          />
          <TablePagination
            page={query.page}
            totalPages={Math.max(1, Math.ceil(visible.length / query.pageSize))}
            pageSize={query.pageSize}
            total={visible.length}
            onPageChange={query.setPage}
            loading={facts.isFetching}
          />
          <AgentLedgerPanel facts={facts.all} isFetching={facts.isFetching} />
        </div>
      )}
    </Card>
  );
}

function MatrixHeader({
  data,
  allRows,
  query,
}: {
  data: { compliantCount: number; total: number; pendingCount: number } | undefined;
  allRows: ComplianceRowData[];
  query: ListTableQueryState;
}) {
  const { t } = useTranslation('rfp');

  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle px-4 py-2">
      <div>
        <h2 className="text-sm font-semibold text-fg-primary">{t('compliance.heading')}</h2>
        {data && (
          <p className="mt-0.5 text-xs text-fg-tertiary">
            {t('compliance.summary', {
              compliant: data.compliantCount,
              total: data.total,
              pending: data.pendingCount,
            })}
          </p>
        )}
      </div>
      {allRows.length > 0 && (
        <ComplianceMatrixToolbar
          query={query}
          statusOptions={COMPLIANCE_STATUSES.map((value) => ({
            value,
            label: t(`compliance.status.${value}`, STATUS_FALLBACK[value] ?? value),
          }))}
          sectionOptions={sectionOptions(allRows)}
          statusCounts={statusCounts(allRows)}
        />
      )}
    </header>
  );
}

/** Loading, error and empty — the three states a data surface may never skip. */
function MatrixFetchStates({
  isLoading,
  isError,
  error,
  isEmpty,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
}) {
  const { t } = useTranslation('rfp');

  if (isLoading) {
    return (
      <div className="p-4">
        <LoadingSkeleton rows={6} />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="p-4">
        <p role="alert" className="text-sm text-danger">
          {error instanceof Error ? error.message : t('states.error')}
        </p>
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="p-6">
        <EmptyState title={t('compliance.emptyTitle')} message={t('compliance.emptyMessage')} />
      </div>
    );
  }
  return null;
}

function AgentLedgerPanel({ facts, isFetching }: { facts: BidFact[]; isFetching: boolean }) {
  const { t } = useTranslation('rfp');

  return (
    <details className="border-t border-border-subtle pt-2">
      <summary className="cursor-pointer text-xs font-medium text-fg-secondary">
        {t('agent.rationaleListTitle', 'What the agent did')}
      </summary>
      {/* Scoped to the requirements on this page: the list endpoint takes one
          subject at a time, so an opportunity-wide ledger needs a
          `?opportunityId=` filter that does not exist yet (Round 3). */}
      <p className="px-3 pt-1 text-[11px] text-fg-tertiary">
        {t('agent.rationaleScope', 'Covers the requirements shown on this page.')}
      </p>
      <AgentRationaleList facts={facts} isLoading={isFetching} />
    </details>
  );
}

type MatrixTableProps = {
  rows: ComplianceRowData[];
  factsFor: (rowId: string) => SubjectFacts;
  query: ListTableQueryState;
  onSave: (rowId: string, answerDraft: string) => void;
  isSaving: boolean;
  decide: ReturnType<typeof useDecideBidFact>;
};

function MatrixTable({ rows, factsFor, query, onSave, isSaving, decide }: MatrixTableProps) {
  const { t } = useTranslation('rfp');
  const inFlightFactId = decide.variables?.factId ?? null;

  return (
    <Table
      className="table-fixed"
      containerClassName="max-h-[520px] overflow-auto rounded-lg border border-border-default bg-surface-card"
    >
      <MatrixHead query={query} />
      <TableBody>
        {rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell
              colSpan={COLUMN_COUNT}
              className="h-24 whitespace-normal text-center align-middle text-fg-secondary"
            >
              {t('compliance.noMatches', 'No requirements match these filters.')}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => {
            const rowFacts = factsFor(row.id);
            return (
              <ComplianceRow
                key={row.id}
                row={row}
                proposed={rowFacts.proposed}
                applied={rowFacts.applied[0] ?? null}
                columnCount={COLUMN_COUNT}
                expanded={query.isExpanded(row.id)}
                onToggleExpanded={() => query.toggleExpanded(row.id)}
                onSave={onSave}
                isSaving={isSaving}
                busyFactId={decide.isPending ? inFlightFactId : null}
                errorFactId={decide.isError ? inFlightFactId : null}
                errorMessage={decide.error instanceof Error ? decide.error.message : null}
                onDecide={(factId, decision) =>
                  decide.mutate({ factId, decision, subjectId: row.id })
                }
              />
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

function MatrixHead({ query }: { query: ListTableQueryState }) {
  const { t } = useTranslation('rfp');

  return (
    // Sticky, opaque, and rules drawn with an inset shadow: a sticky <th>
    // border scrolls away with the cell box in Safari (table.tsx's own note).
    <TableHeader className="sticky top-0 z-10 bg-surface-sunken [&_th]:bg-surface-sunken [&_tr]:border-0 [&_tr]:shadow-[inset_0_-1px_0_var(--border-default)]">
      <TableRow className="hover:bg-transparent">
        <SortableHead id="requirement" query={query} className="w-1/3">
          {t('compliance.colRequirement')}
        </SortableHead>
        <TableHead className="h-9 w-1/3 px-3 font-normal text-fg-secondary">
          {t('compliance.colAnswer', 'Answer')}
        </TableHead>
        <SortableHead id="status" query={query} className="w-1/6">
          {t('compliance.colStatus')}
        </SortableHead>
        <SortableHead id="confidence" query={query} className="w-1/12" align="right">
          {t('compliance.colConfidence', 'Confidence')}
        </SortableHead>
        <TableHead className="h-9 w-1/12 px-3">
          <span className="sr-only">{t('compliance.colActions', 'Actions')}</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

function SortableHead({
  id,
  query,
  className,
  align = 'left',
  children,
}: {
  id: string;
  query: ListTableQueryState;
  className?: string;
  align?: 'left' | 'right';
  children: ReactNode;
}) {
  const active = query.sort === id;

  return (
    <TableHead
      className={cn(
        'h-9 px-3 font-normal text-fg-secondary',
        align === 'right' && 'text-right',
        className,
      )}
      aria-sort={active ? (query.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => query.toggleSort(id)}
        className={cn(
          '-ml-2 h-auto px-2 py-1 font-normal',
          align === 'right' && '-mr-2 ml-0 flex-row-reverse',
        )}
      >
        {children}
        <Icon
          name="caret"
          size={12}
          className={cn(
            'opacity-40',
            active && 'opacity-100',
            active && query.dir === 'desc' && 'rotate-180',
          )}
        />
      </Button>
    </TableHead>
  );
}
