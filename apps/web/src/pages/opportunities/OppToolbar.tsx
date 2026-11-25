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
import { CreateOpportunityDialog } from '@/components/opportunity/CreateOpportunityDialog';
import { ImportOpportunitiesDialog } from '@/components/opportunity/ImportOpportunitiesDialog';
import { PipelineViewSwitch } from '@/components/opportunity/PipelineViewSwitch';
import { Button } from '@/components/ui/Button';
import {
  formatUnspecifiedAmount,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';
import type { OrgSummary } from '@/hooks/useOrgSummary';
import { cn } from '@/lib/cn';
import { formatStage } from '@/lib/format';
import { useTranslation } from 'react-i18next';

import type { Opportunity, PipelineStage } from '@bidstack/shared';

import { opportunityKpiView } from './opportunity-kpi';

// ── OppKpiBar ─────────────────────────────────────────────────────────────────

/**
 * Headline KPIs. With no filter, counts and open pipeline come from the server
 * aggregate so a 50-row page is not mistaken for the book. Weighted revenue
 * has no server aggregate, so it stays on the loaded rows and is labelled
 * "(page)". A stage, due, or search filter is that page only — the aggregate
 * is the whole book and must not sit above the shorter list.
 */
export function OppKpiBar({
  opps,
  summary,
  filtered = false,
  pageContinues = false,
}: {
  opps: Opportunity[];
  summary?: OrgSummary;
  /** True when stage, due, or search is narrowing the list. */
  filtered?: boolean;
  /** The filtered read has another page, so these figures are not every match. */
  pageContinues?: boolean;
}) {
  const { t } = useTranslation('crm');
  const view = opportunityKpiView({ opps, summary, filtered });
  const regionLabel =
    view.region === 'filtered'
      ? t('oppToolbar.kpiRegionFiltered', 'Filtered opportunities on this page')
      : t('oppToolbar.kpiRegionLabel', 'Opportunities KPI summary');
  return (
    <div role="region" aria-label={regionLabel} className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {view.cards.map((card) => (
          <div
            key={card.key}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3"
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
              {t(card.labelKey, card.label)}
            </div>
            {/* One line each, so the card height never depends on which values
                have arrived (the summary swap used to rewrap and shift the page:
                CLS 0.064 against the 0.05 budget). */}
            <div className="mt-1 truncate text-lg font-bold tabular-nums text-[var(--fg-primary)]">
              {card.money ? formatUnspecifiedAmount(card.amount) : card.amount.toLocaleString()}
            </div>
            <div
              className="truncate text-xs text-[var(--fg-tertiary)]"
              title={card.money ? UNSPECIFIED_CURRENCY_BASIS : undefined}
            >
              {card.money ? UNSPECIFIED_CURRENCY_BASIS : '\u00a0'}
            </div>
          </div>
        ))}
      </div>
      {filtered && pageContinues ? (
        <p className="text-sm text-[var(--fg-secondary)]">
          {t('oppToolbar.kpiPagePartial', 'These figures are this page, not every match.')}
        </p>
      ) : null}
    </div>
  );
}

// ── OppPageHeader ─────────────────────────────────────────────────────────────

export function OppPageHeader({
  search,
  stageFilter,
  stageOptions,
  itemCount,
  hasData,
  isExporting = false,
  onClearSearch,
  onClearStageFilter,
  onExportCsv,
}: {
  search: string | undefined;
  stageFilter: string | null;
  stageOptions: PipelineStage[];
  itemCount: number;
  hasData: boolean;
  /** True while the CSV download fetch is in flight — disables + relabels the button. */
  isExporting?: boolean;
  onClearSearch: () => void;
  onClearStageFilter: () => void;
  onExportCsv: () => void;
}) {
  const { t } = useTranslation('crm');
  // Resolve a configured stage id (UUID) to its name; fall back to formatStage
  // for legacy enum ids so the subtitle never shows a raw UUID.
  const stageFilterLabel = stageFilter
    ? (stageOptions.find((s) => s.id === stageFilter)?.name ?? formatStage(stageFilter))
    : '';
  const clearBtnClass =
    'ml-2 rounded text-xs text-[var(--fg-tertiary)] underline hover:text-[var(--brand-primary)] dark:hover:text-[var(--brand-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]';

  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="page-title">{t('oppToolbar.title', 'Opportunities')}</h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {search ? (
            <>
              <span className="font-medium text-[var(--fg-primary)]">{itemCount}</span>{' '}
              {t('oppToolbar.resultsFor', 'results for')}{' '}
              <span className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 font-mono text-xs">
                &ldquo;{search}&rdquo;
              </span>{' '}
              <button type="button" onClick={onClearSearch} className={clearBtnClass}>
                {t('oppToolbar.clear', 'clear')}
              </button>
            </>
          ) : stageFilter ? (
            <>
              <span className="font-medium text-[var(--fg-primary)]">{itemCount}</span>{' '}
              {t('oppToolbar.stageOpportunities', '{{stage}} opportunities', {
                stage: stageFilterLabel.toLowerCase(),
              })}
              <button type="button" onClick={onClearStageFilter} className={clearBtnClass}>
                {t('oppToolbar.clearFilter', 'clear filter')}
              </button>
            </>
          ) : (
            <>
              {t('oppToolbar.bidsInFlight', '{{count}} bids in flight · click any cell to edit inline.', {
                count: itemCount,
              })}
            </>
          )}
        </p>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
        <PipelineViewSwitch current="list" />
        <ImportOpportunitiesDialog />
        <Button
          size="sm"
          variant="secondary"
          onClick={onExportCsv}
          disabled={!hasData || isExporting}
          aria-label={
            isExporting
              ? t('oppToolbar.exportingLabel', 'Exporting opportunities…')
              : t('oppToolbar.exportLabel', 'Export visible opportunities as CSV')
          }
        >
          {isExporting
            ? t('oppToolbar.exporting', 'Exporting…')
            : t('oppToolbar.exportCsv', 'Export CSV')}
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
  const { t } = useTranslation('crm');
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
      aria-label={t('oppToolbar.stageFilterGroupLabel', 'Filter opportunities by stage')}
      className="flex flex-wrap items-center gap-1.5"
    >
      <button
        type="button"
        aria-pressed={!stageFilter}
        onClick={() => onSetStageFilter(null)}
        className={chipClass(!stageFilter)}
      >
        {t('oppToolbar.stageAll', 'All')}
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

// ── OppDueChips ───────────────────────────────────────────────────────────────
// A1 (bid clock): quick filters for the two urgency buckets that matter for
// action — "due soon" and "already missed". Same toggle-pill pattern as
// OppStageChips (click again to clear) so the two chip rows read as one
// filtering language, not two different UI idioms.

export type DueQuickFilter = 'within7' | 'overdue' | null;

export function OppDueChips({
  dueFilter,
  onSetDueFilter,
}: {
  dueFilter: DueQuickFilter;
  onSetDueFilter: (next: DueQuickFilter) => void;
}) {
  const { t } = useTranslation('crm');
  const chipClass = (active: boolean, tone: 'amber' | 'tomato') =>
    cn(
      'rounded-full px-3 py-1 text-xs font-medium transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]',
      active
        ? tone === 'amber'
          ? 'bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)]'
          : 'bg-[var(--tag-tomato-bg)] text-[var(--tag-tomato-fg)]'
        : 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]',
    );

  return (
    <div
      role="group"
      aria-label={t('oppToolbar.dueFilterGroupLabel', 'Filter opportunities by due date')}
      className="flex flex-wrap items-center gap-1.5"
    >
      <button
        type="button"
        aria-pressed={dueFilter === 'within7'}
        onClick={() => onSetDueFilter(dueFilter === 'within7' ? null : 'within7')}
        className={chipClass(dueFilter === 'within7', 'amber')}
      >
        {t('oppToolbar.dueWithin7', 'Due ≤ 7d')}
      </button>
      <button
        type="button"
        aria-pressed={dueFilter === 'overdue'}
        onClick={() => onSetDueFilter(dueFilter === 'overdue' ? null : 'overdue')}
        className={chipClass(dueFilter === 'overdue', 'tomato')}
      >
        {t('oppToolbar.dueOverdue', 'Overdue')}
      </button>
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
  canWrite,
}: {
  selectedCount: number;
  stageOptions: PipelineStage[];
  onBulkStageChange: (stageId: string) => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
  /** P1 #24: disable controls while a stage-move or delete is in-flight */
  isPending?: boolean;
  /** False when the signed-in user lacks opportunities:write — hides the
   * move/delete controls (both 403 server-side otherwise); Clear stays since
   * it's local-only state. */
  canWrite: boolean;
}) {
  const { t } = useTranslation('crm');
  return (
    <div
      role="region"
      aria-label={t('oppToolbar.bulkActionsLabel', 'Bulk actions')}
      className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--brand-primary)] bg-[var(--brand-primary-tint)] px-3 py-2 text-xs shadow-[var(--shadow-sm)] backdrop-blur"
    >
      <span className="font-medium text-[var(--fg-primary)]">
        {t('oppToolbar.selectedCount', '{{count}} selected', { count: selectedCount })}
      </span>
      <div className="flex items-center gap-2">
        {canWrite && (
          <>
            <select
              aria-label={t('oppToolbar.moveSelectionLabel', 'Move selection to stage')}
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
              <option value="">{t('oppToolbar.moveToStage', 'Move to stage…')}</option>
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
              {t('oppToolbar.deleteSelected', 'Delete selected')}
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={onClearSelection} disabled={isPending}>
          {t('oppToolbar.clearSelection', 'Clear')}
        </Button>
      </div>
    </div>
  );
}
