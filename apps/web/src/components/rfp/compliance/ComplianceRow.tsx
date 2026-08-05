// One requirement, at table density, in three slots:
//
//   value | provenance-if-applied | suggestion-if-proposed
//
// The value is the answer as it stands. If an agent fact was accepted into it,
// the value carries a dotted underline and a hover receipt (SourcedValue +
// Provenance). If a fact is still proposed, a pale strip sits under the row
// with the proposal, its rationale, and the two clicks that settle it.
//
// UNKNOWN IS NEUTRAL. AssessmentStatus PENDING/UNAVAILABLE renders a grey dot
// and the words "Not assessed", and a null confidence renders an em-dash —
// never a red badge, never 0%. "We have not looked at this" is not "this
// fails", and the matrix is the one screen where confusing the two loses bids.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';

import { ProposedAnswers } from '@/components/agent/ProposedAnswers';
import { confidencePct, pageRange } from '@/components/agent/bid-fact-view';
import { AiDisclosureBadge } from '@/components/rfp/shared/AiDisclosureBadge';
import { EmptyCellValue } from '@/components/table-kit/empty-cell';
import { Provenance, SOURCED_VALUE, SourcedValue } from '@/components/table-kit/sourced-value';
import { StatusIndicator, type StatusTone } from '@/components/table-kit/status-indicator';
import { TableCell, TableRow } from '@/components/table-kit/table';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { BidFact } from '@/hooks/agent/useBidFacts';
import type { ComplianceRow as ComplianceRowData } from '@/hooks/rfp/useRfpCompliance';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { ROW_ACCENT } from '@/lib/table/row-accent';

import { ComplianceAnswerEditor } from './ComplianceAnswerEditor';

const STATUS_TONE: Record<ComplianceRowData['status'], StatusTone> = {
  // Not "error": a pending row has no verdict at all yet.
  pending: 'neutral',
  compliant: 'success',
  partial: 'warning',
  non_compliant: 'error',
};

const STATUS_FALLBACK: Record<ComplianceRowData['status'], string> = {
  pending: 'Pending',
  compliant: 'Compliant',
  partial: 'Partial',
  non_compliant: 'Non-compliant',
};

export interface ComplianceRowProps {
  row: ComplianceRowData;
  /** Live proposals for this row. */
  proposed: readonly BidFact[];
  /** The fact currently behind this row's answer, if the answer came from one. */
  applied: BidFact | null;
  columnCount: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSave: (rowId: string, answerDraft: string) => void;
  isSaving: boolean;
  busyFactId: string | null;
  errorFactId: string | null;
  errorMessage: string | null;
  onDecide: (factId: string, decision: 'accept' | 'dismiss') => void;
}

export function ComplianceRow(props: ComplianceRowProps) {
  const { row, proposed, applied, columnCount, expanded, onToggleExpanded } = props;
  const { t } = useTranslation('rfp');
  const [isEditing, setIsEditing] = useState(false);
  const detailId = `compliance-detail-${row.id}`;

  function handleDone(html: string) {
    props.onSave(row.id, html);
    setIsEditing(false);
  }

  return (
    <>
      <TableRow
        className={ROW_ACCENT}
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        aria-controls={detailId}
      >
        <TableCell className="overflow-hidden px-3 py-2">
          <span className="flex items-center gap-1.5">
            {row.mandatory && (
              <span
                className="text-xs font-semibold text-warning"
                title={t('compliance.mandatory', 'Mandatory')}
                aria-label={t('compliance.mandatory', 'Mandatory')}
              >
                *
              </span>
            )}
            <span className="truncate text-xs text-fg-primary" title={row.requirement}>
              {row.requirement}
            </span>
          </span>
        </TableCell>

        <TableCell className="overflow-hidden px-3 py-2">
          <AnswerCell row={row} applied={applied} />
        </TableCell>

        <TableCell className="overflow-hidden px-3 py-2">
          <StatusIndicator
            size="sm"
            tone={STATUS_TONE[row.status]}
            label={t(`compliance.status.${row.status}`, STATUS_FALLBACK[row.status])}
          />
          {row.assessmentStatus === 'UNAVAILABLE' && (
            // The AI fallback ran without producing an assessment — say so
            // plainly rather than implying a 0% score or a PARTIAL verdict.
            <span className="block truncate text-[11px] italic text-fg-secondary">
              {t('compliance.notAssessed', 'Not assessed')}
            </span>
          )}
        </TableCell>

        <TableCell className="px-3 py-2 text-right tabular-nums text-fg-secondary">
          <ConfidenceCell row={row} />
        </TableCell>

        <TableCell className="px-3 py-2 text-right">
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              // The row toggles the detail; the button opens the editor. Without
              // this the click would do both and the editor would open inside a
              // panel that is closing.
              event.stopPropagation();
              setIsEditing(true);
              if (!expanded) onToggleExpanded();
            }}
            aria-label={`${t('compliance.edit', 'Edit')}: ${row.requirement}`}
          >
            {t('compliance.edit', 'Edit')}
          </Button>
        </TableCell>
      </TableRow>

      {proposed.length > 0 && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={columnCount} className="whitespace-normal p-0">
            <div className="py-1 pl-6 pr-3">
              <ProposedAnswers
                facts={proposed}
                busyFactId={props.busyFactId}
                errorFactId={props.errorFactId}
                errorMessage={props.errorMessage}
                onDecide={props.onDecide}
              />
            </div>
          </TableCell>
        </TableRow>
      )}

      {(expanded || isEditing) && (
        <TableRow className="hover:bg-transparent">
          <TableCell
            colSpan={columnCount}
            id={detailId}
            className="whitespace-normal bg-surface-soft px-6 py-3 align-top"
          >
            <RowDetail
              row={row}
              applied={applied}
              isEditing={isEditing}
              isSaving={props.isSaving}
              onDone={handleDone}
              onCancelEdit={() => setIsEditing(false)}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function AnswerCell({ row, applied }: { row: ComplianceRowData; applied: BidFact | null }) {
  const { t } = useTranslation('rfp');

  if (!row.response) {
    return (
      <span className="flex items-center gap-2">
        <EmptyCellValue />
        <span className="sr-only">
          {t('compliance.noResponse', 'No response — pending review')}
        </span>
      </span>
    );
  }

  // Sanitize before rendering: the string is TipTap HTML written by people and
  // by the agent, and stored HTML needs defence in depth regardless of CSP.
  const answer = (
    <span
      className={cn('block truncate text-xs text-fg-primary', applied && SOURCED_VALUE)}
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(row.response) }}
    />
  );

  if (!applied) return answer;

  return (
    <SourcedValue source={<AppliedProvenance fact={applied} />} side="top">
      {answer}
    </SourcedValue>
  );
}

/** The receipt: the claim, every citation, and when the agent observed it. */
export function AppliedProvenance({ fact }: { fact: BidFact }) {
  const { t } = useTranslation('rfp');

  const reasons = fact.citations.map((citation) => {
    const pages = pageRange(citation);
    const where = [citation.documentName, pages ? `p. ${pages}` : null].filter(Boolean).join(', ');
    return where ? `${where}: “${citation.quote}”` : `“${citation.quote}”`;
  });

  return (
    <Provenance
      claim={fact.claim}
      reasons={reasons}
      observedAt={t('agent.observedAt', 'Observed {{date}}', { date: formatDate(fact.createdAt) })}
    />
  );
}

function ConfidenceCell({ row }: { row: ComplianceRowData }) {
  const pct = confidencePct(row.aiConfidenceBps);
  // Null confidence = no assessment produced one. An em-dash, never a fake 0%.
  if (pct === null) return <EmptyCellValue />;
  return <span aria-label={`AI confidence: ${pct}%`}>{pct}%</span>;
}

function RowDetail({
  row,
  applied,
  isEditing,
  isSaving,
  onDone,
  onCancelEdit,
}: {
  row: ComplianceRowData;
  applied: BidFact | null;
  isEditing: boolean;
  isSaving: boolean;
  onDone: (html: string) => void;
  onCancelEdit: () => void;
}) {
  const { t } = useTranslation('rfp');

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-fg-primary">{row.requirement}</p>

      {row.response ? (
        <div
          className="prose prose-xs max-w-none text-xs text-fg-secondary dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(row.response) }}
        />
      ) : (
        <p className="text-xs italic text-fg-tertiary">
          {t('compliance.noResponse', 'No response — pending review')}
        </p>
      )}

      {applied && <AppliedRationaleLine fact={applied} />}

      {row.autoFilled && (
        // EU AI Act Art. 50 — the disclosure is never behind a toggle. It moved
        // out of the dense row and into the detail so the grid stays scannable;
        // the row itself still says "not assessed" inline where that applies.
        <AiDisclosureBadge />
      )}

      {isEditing && (
        <ComplianceAnswerEditor
          initialContent={row.response ?? ''}
          onDone={onDone}
          onCancel={onCancelEdit}
          isSaving={isSaving}
          rowLabel={row.requirement}
        />
      )}
    </div>
  );
}

/** "filled from Meridian delivery model, p. 14 — accepted 4 Aug 2026". */
function AppliedRationaleLine({ fact }: { fact: BidFact }) {
  const { t } = useTranslation('rfp');
  const source = fact.citations[0];
  const pages = source ? pageRange(source) : null;

  const origin =
    source?.documentName && pages
      ? t('agent.filledFromPage', 'filled from {{document}}, p. {{pages}}', {
          document: source.documentName,
          pages,
        })
      : source?.documentName
        ? t('agent.filledFrom', 'filled from {{document}}', { document: source.documentName })
        : t('agent.filledByAgent', 'filled by the bid agent');

  const settled = fact.decidedAt
    ? t('agent.acceptedOn', 'accepted {{date}}', { date: formatDate(fact.decidedAt) })
    : null;

  return (
    <p className="flex items-center gap-1.5 text-[11px] text-fg-secondary">
      <Icon name="sparkle" size={12} />
      {[origin, settled].filter(Boolean).join(' — ')}
    </p>
  );
}
