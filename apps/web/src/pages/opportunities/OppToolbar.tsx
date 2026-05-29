/**
 * opportunities/OppToolbar.tsx — four co-located "above-table" UI sections.
 *
 * WHY co-located: all four components are only used by OpportunitiesPage,
 * have no internal state, and together form the toolbar layer of the page.
 * Keeping them in one module avoids four near-empty files while staying well
 * below the 400-line cap.
 *
 *   OppKpiBar       — 4-metric KPI strip above the header
 *   OppPageHeader   — h1 + subtitle + action buttons
 *   OppStageChips   — quick-filter pill group
 *   OppBulkBar      — sticky bulk-action bar (stage move + delete + clear)
 */
import { useNavigate } from 'react-router-dom';

import { CreateOpportunityDialog } from '@/components/opportunity/CreateOpportunityDialog';
import { ImportOpportunitiesDialog } from '@/components/opportunity/ImportOpportunitiesDialog';
import { Button } from '@/components/ui/Button';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { cn } from '@/lib/cn';
import { formatStage } from '@/lib/format';

import type { Opportunity, PipelineStage } from '@bidstack/shared';

// ── OppKpiBar ─────────────────────────────────────────────────────────────────

export function OppKpiBar({ opps }: { opps: Opportunity[] }) {
  const { formatMoney } = useFormatMoney();
  const totalValue = opps.reduce((acc, o) => acc + o.value, 0);
  const openOpps = opps.filter((o) => !o.pipelineStage?.isWon && !o.pipelineStage?.isLost);
  const openValue = openOpps.reduce((acc, o) => acc + o.value, 0);
  const weighted = openOpps.reduce((acc, o) => acc + o.value * (o.probability / 100), 0);
  const kpis = [
    { label: 'Opportunities', value: String(opps.length) },
    { label: 'Revenue', value: formatMoney(totalValue, 'EUR') },
    { label: 'WR', value: formatMoney(weighted, 'EUR') },
    { label: 'Open', value: formatMoney(openValue, 'EUR') },
  ];
  return (
    <div
      role="region"
      aria-label="Opportunities KPI summary"
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
            {kpi.label}
          </div>
          <div className="mt-1 text-lg font-bold tabular-nums text-[var(--fg-primary)]">
            {kpi.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── OppPageHeader ─────────────────────────────────────────────────────────────

export function OppPageHeader({
  search,
  stageFilter,
  itemCount,
  hasData,
  isExporting = false,
  onClearSearch,
  onClearStageFilter,
  onExportCsv,
}: {
  search: string | undefined;
  stageFilter: string | null;
  itemCount: number;
  hasData: boolean;
  /** True while the CSV download fetch is in flight — disables + relabels the button. */
  isExporting?: boolean;
  onClearSearch: () => void;
  onClearStageFilter: () => void;
  onExportCsv: () => void;
}) {
  const navigate = useNavigate();

  const clearBtnClass =
    'ml-2 rounded text-xs text-[var(--fg-tertiary)] underline hover:text-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]';

  return (
    <header className="flex items-start justify-between gap-3">
      <div>
        <h1 className="gradient-text text-2xl font-bold tracking-tight text-[var(--fg-primary)]">
          Opportunities
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {search ? (
            <>
              <span className="font-medium text-[var(--fg-primary)]">{itemCount}</span> results for{' '}
              <span className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 font-mono text-xs">
                &ldquo;{search}&rdquo;
              </span>{' '}
              <button type="button" onClick={onClearSearch} className={clearBtnClass}>
                clear
              </button>
            </>
          ) : stageFilter ? (
            <>
              <span className="font-medium text-[var(--fg-primary)]">{itemCount}</span>{' '}
              {formatStage(stageFilter).toLowerCase()} opportunities
              <button type="button" onClick={onClearStageFilter} className={clearBtnClass}>
                clear filter
              </button>
            </>
          ) : (
            <>{itemCount} bids in flight · click any cell to edit inline.</>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigate('/pipeline')}
          aria-label="Switch to kanban view"
        >
          Kanban
        </Button>
        <ImportOpportunitiesDialog />
        <Button
          size="sm"
          variant="secondary"
          onClick={onExportCsv}
          disabled={!hasData || isExporting}
          aria-label={
            isExporting ? 'Exporting opportunities…' : 'Export visible opportunities as CSV'
          }
        >
          {isExporting ? 'Exporting…' : 'Export CSV'}
        </Button>
        <CreateOpportunityDialog />
      </div>
    </header>
  );
}

// ── OppStageChips ─────────────────────────────────────────────────────────────

export function OppStageChips({
  stageFilter,
  stageOptions,
  onSetStageFilter,
}: {
  stageFilter: string | null;
  stageOptions: PipelineStage[];
  onSetStageFilter: (id: string | null) => void;
}) {
  // WHY cn() over template literal: cn() handles class merging correctly and
  // avoids whitespace artifacts from string interpolation.
  const chipClass = (active: boolean) =>
    cn(
      'rounded-full px-3 py-1 text-xs font-medium transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]',
      active
        ? 'bg-[var(--fg-primary)] text-[var(--surface-page)]'
        : 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]',
    );

  return (
    <div
      role="group"
      aria-label="Filter opportunities by stage"
      className="flex flex-wrap items-center gap-1.5"
    >
      <button
        type="button"
        aria-pressed={!stageFilter}
        onClick={() => onSetStageFilter(null)}
        className={chipClass(!stageFilter)}
      >
        All
      </button>
      {stageOptions.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={stageFilter === s.id}
          onClick={() => onSetStageFilter(stageFilter === s.id ? null : s.id)}
          className={chipClass(stageFilter === s.id)}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}

// ── OppBulkBar ────────────────────────────────────────────────────────────────

export function OppBulkBar({
  selectedCount,
  stageOptions,
  onBulkStageChange,
  onBulkDelete,
  onClearSelection,
  isPending = false,
}: {
  selectedCount: number;
  stageOptions: PipelineStage[];
  onBulkStageChange: (stageId: string) => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
  /** P1 #24: disable controls while a stage-move or delete is in-flight */
  isPending?: boolean;
}) {
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--brand-primary)] bg-[var(--brand-primary-tint)] px-3 py-2 text-xs shadow-[var(--shadow-sm)] backdrop-blur"
    >
      <span className="font-medium text-[var(--fg-primary)]">{selectedCount} selected</span>
      <div className="flex items-center gap-2">
        <select
          aria-label="Move selection to stage"
          defaultValue=""
          disabled={isPending}
          onChange={(e) => {
            const next = e.target.value;
            if (next) {
              onBulkStageChange(next);
              e.target.value = '';
            }
          }}
          className="dialog-input disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">Move to stage…</option>
          {stageOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="ghost"
          onClick={onBulkDelete}
          disabled={isPending}
          className="text-[var(--danger)] hover:text-[var(--danger)]"
        >
          Delete selected
        </Button>
        <Button size="sm" variant="ghost" onClick={onClearSelection} disabled={isPending}>
          Clear
        </Button>
      </div>
    </div>
  );
}
