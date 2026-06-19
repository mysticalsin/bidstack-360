/**
 * opportunities/OpportunityRow.tsx — memoised table row for a single
 * opportunity. Imports the inline-edit cells from OppInlineEditCells so
 * this file stays focused on row-level interaction only.
 *
 * UpdatedAgo is co-located here (not exported) because it only makes sense
 * as a child of this row and wraps a single hook call — isolating it so the
 * schedule timer re-renders only this span, not the whole row.
 */
import { memo, useState } from 'react';
import { Link } from 'react-router-dom';

import { announceStageChange } from '@/components/a11y/useAnnouncer';
import { useConfetti } from '@/components/delight/useConfetti';
import { Badge } from '@/components/ui/Badge';
import { SavedFlash } from '@/components/ui/SavedFlash';
import { toast } from '@/components/ui/Toast';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { useLiveRelativeTime } from '@/hooks/useLiveRelativeTime';
import type { usePatchOpportunity } from '@/hooks/useOpportunities';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { isPipelineStageIdUuid, resolvePipelineStage } from '@/lib/pipeline-stages';
import { prefetchRoute } from '@/lib/prefetch';

import type { Opportunity, PipelineStage } from '@bidstack/shared';

import { DateCell, NumberCell, StageCell } from './OppInlineEditCells';

// ── UpdatedAgo ────────────────────────────────────────────────────────────────

function UpdatedAgo({ iso }: { iso: string }) {
  const label = useLiveRelativeTime(iso);
  return (
    <>
      <span className="mx-1.5 text-[var(--fg-muted)]" aria-hidden>
        ·
      </span>
      <span data-testid="opportunity-updated-at" title={new Date(iso).toLocaleString()}>
        {label}
      </span>
    </>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────
// One row. Receives a shared patch mutation so we avoid creating 100
// useMutation hooks (one per row) which is expensive for React Query.

export const Row = memo(function Row({
  opp,
  stageOptions,
  isSelected,
  onToggleSelect,
  patch,
}: {
  opp: Opportunity;
  stageOptions: PipelineStage[];
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  patch: ReturnType<typeof usePatchOpportunity>;
}) {
  const { formatMoney } = useFormatMoney();
  const fireConfetti = useConfetti((s) => s.fire);

  // Per-field flash timestamp. Bumping a field's value re-triggers the
  // SavedFlash chip next to that cell, independent of the others.
  const [saved, setSaved] = useState<{
    stage: number;
    value: number;
    probability: number;
    dueDate: number;
  }>({ stage: 0, value: 0, probability: 0, dueDate: 0 });

  const flash = (field: 'stage' | 'value' | 'probability' | 'dueDate') =>
    setSaved((s) => ({ ...s, [field]: s[field] + 1 }));

  // Per-field in-flight tracking (P1 #22). The shared `patch` mutation can
  // only tell us SOMETHING is saving — not which row or field. Local booleans
  // give each cell its own cursor-wait / aria-busy state so the UX is precise.
  const [saving, setSaving] = useState<{
    stage: boolean;
    value: boolean;
    probability: boolean;
    dueDate: boolean;
  }>({ stage: false, value: false, probability: false, dueDate: false });

  const startSave = (field: 'stage' | 'value' | 'probability' | 'dueDate') =>
    setSaving((s) => ({ ...s, [field]: true }));
  const endSave = (field: 'stage' | 'value' | 'probability' | 'dueDate') =>
    setSaving((s) => ({ ...s, [field]: false }));

  const savedToast = (field: string) => toast.success(`${field} updated`, { duration: 2200 });
  const errorToast = (err: unknown) =>
    toast.error('Update failed', {
      description: err instanceof Error ? err.message : 'The server rejected the request.',
    });

  // Hover-prefetch the detail route. Apple's "look at it before tap" feel —
  // by the time the click lands, the lazy chunk is parsed and the React
  // Query cache is warm via the route's loader (if any).
  const prefetch = () => prefetchRoute('/opportunities/:id');

  return (
    <tr
      className={cn(
        'group transition-colors hover:bg-[var(--surface-sunken)]',
        isSelected && 'bg-[var(--brand-primary-tint)]/60',
      )}
      data-selected={isSelected ? 'true' : undefined}
      onMouseEnter={prefetch}
    >
      <td className="w-10 px-5 py-3">
        <label className="table-checkbox-hit">
          <span className="sr-only">
            {isSelected ? `Deselect ${opp.name}` : `Select ${opp.name}`}
          </span>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(opp.id)}
            onClick={(e) => e.stopPropagation()}
            className="cursor-pointer accent-[var(--brand-primary)]"
          />
        </label>
      </td>

      <td className="px-5 py-3 font-mono text-xs text-[var(--fg-tertiary)]">
        <Link to={`/opportunities/${opp.id}`} className="hover:text-[var(--brand-primary)]">
          {opp.code}
        </Link>
      </td>

      <td className="px-5 py-3">
        <Link
          to={`/opportunities/${opp.id}`}
          className="font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)]"
        >
          {opp.name}
        </Link>
        <div className="text-xs text-[var(--fg-tertiary)]">
          <span>{opp.customer}</span>
          <UpdatedAgo iso={opp.updatedAt} />
        </div>
      </td>

      <td className="px-5 py-3">
        {opp.territoryName ? (
          <Badge tone="teal">{opp.territoryName}</Badge>
        ) : opp.country ? (
          <span className="text-xs text-[var(--fg-tertiary)]">{opp.country}</span>
        ) : (
          <span className="text-xs text-[var(--fg-tertiary)]">—</span>
        )}
      </td>

      <td className="px-5 py-3">
        <StageCell
          stage={resolvePipelineStage(opp)}
          options={stageOptions}
          isSaving={saving.stage}
          onSave={(nextId) => {
            const nextStage = stageOptions.find((s) => s.id === nextId);
            startSave('stage');
            patch.mutate(
              {
                id: opp.id,
                patch: isPipelineStageIdUuid(nextId)
                  ? { pipelineStageId: nextId }
                  : { stage: nextId, pipelineStageId: null },
              },
              {
                onSuccess: () => {
                  endSave('stage');
                  savedToast('Stage');
                  flash('stage');
                  // Confetti only on closed_won, never on closed_lost —
                  // no celebration for a lost bid.
                  if (nextStage?.isWon) {
                    fireConfetti();
                    toast.success(`🎉 Won "${opp.name}"!`, { duration: 5000 });
                  }
                  // Announce every stage move to screen readers — this is
                  // the most consequential edit on the page and the live
                  // region keeps SR users in sync.
                  announceStageChange(`${opp.name} moved to ${nextStage?.name ?? nextId}`);
                },
                onError: (err) => {
                  endSave('stage');
                  errorToast(err);
                },
              },
            );
          }}
        />
        <SavedFlash trigger={saved.stage} />
      </td>

      <td className="px-5 py-3 text-right">
        <NumberCell
          value={opp.value}
          step={1000}
          min={0}
          align="right"
          isSaving={saving.value}
          format={(v) => formatMoney(v, 'EUR')}
          onSave={(next) => {
            startSave('value');
            patch.mutate(
              { id: opp.id, patch: { value: next } },
              {
                onSuccess: () => {
                  endSave('value');
                  savedToast('Value');
                  flash('value');
                },
                onError: (err) => {
                  endSave('value');
                  errorToast(err);
                },
              },
            );
          }}
        />
        <SavedFlash trigger={saved.value} />
      </td>

      <td className="px-5 py-3 text-right">
        <NumberCell
          value={opp.probability}
          min={0}
          max={100}
          step={5}
          align="right"
          isSaving={saving.probability}
          format={(v) => `${v}%`}
          onSave={(next) => {
            startSave('probability');
            patch.mutate(
              { id: opp.id, patch: { probability: next } },
              {
                onSuccess: () => {
                  endSave('probability');
                  savedToast('Probability');
                  flash('probability');
                },
                onError: (err) => {
                  endSave('probability');
                  errorToast(err);
                },
              },
            );
          }}
        />
        <SavedFlash trigger={saved.probability} />
      </td>

      <td className="px-5 py-3">
        <DateCell
          value={opp.dueDate}
          format={(v) => formatDate(v)}
          isSaving={saving.dueDate}
          onSave={(next) => {
            startSave('dueDate');
            patch.mutate(
              { id: opp.id, patch: { dueDate: next } },
              {
                onSuccess: () => {
                  endSave('dueDate');
                  savedToast('Due date');
                  flash('dueDate');
                },
                onError: (err) => {
                  endSave('dueDate');
                  errorToast(err);
                },
              },
            );
          }}
        />
        <SavedFlash trigger={saved.dueDate} />
      </td>
    </tr>
  );
});
