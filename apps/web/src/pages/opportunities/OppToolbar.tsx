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
import { useFormatMoney } from '@/hooks/useFormatMoney';
import type { OrgSummary } from '@/hooks/useOrgSummary';
import { cn } from '@/lib/cn';
import { formatStage } from '@/lib/format';
import { useTranslation } from 'react-i18next';

import type { Opportunity, PipelineStage } from '@bidstack/shared';

// ── OppKpiBar ─────────────────────────────────────────────────────────────────

/**
 * Headline KPIs. Tenant-wide counts/pipeline come from the server aggregate
 * (`/api/crm/summary`) so they reflect the whole org, not just the current 50-row
 * cursor page — at 100k-company scale a page-derived total under-reports the
 * pipeline by orders of magnitude. Weighted revenue has no server aggregate, so
 * it stays page-derived and is explicitly labelled "(page)" to avoid
 * misrepresenting it as a tenant total.
 */
export function OppKpiBar({ opps, summary }: { opps: Opportunity[]; summary?: OrgSummary }) {
  const { t } = useTranslation('crm');
  const { formatMoney } = useFormatMoney();
  const openOpps = opps.filter((o) => !o.pipelineStage?.isWon && !o.pipelineStage?.isLost);
  const weighted = openOpps.reduce((acc, o) => acc + o.value * (o.probability / 100), 0);
  const kpis = summary
    ? [
        {
          label: t('oppToolbar.kpiOpportunities', 'Opportunities'),
          value: summary.opportunities.toLocaleString(),
        },
        {
          label: t('oppToolbar.kpiOpenCount', 'Open'),
          value: summary.openOpportunities.toLocaleString(),
        },
        {
          label: t('oppToolbar.kpiOpenPipeline', 'Open pipeline'),
          value: formatMoney(summary.pipelineValue, 'EUR'),
        },
        {
          label: t('oppToolbar.kpiWeightedRevenuePage', 'WR (page)'),
          value: formatMoney(weighted, 'EUR'),
        },
      ]
    : [
        // Fallback before the summary resolves: page-derived totals, all labelled
        // "(page)" so they are never mistaken for tenant-wide figures.
        {
          label: t('oppToolbar.kpiOpportunitiesPage', 'Opportunities (page)'),
          value: String(opps.length),
        },
        {
          label: t('oppToolbar.kpiRevenuePage', 'Revenue (page)'),
          value: formatMoney(
            opps.reduce((acc, o) => acc + o.value, 0),
            'EUR',
          ),
        },
        {
          label: t('oppToolbar.kpiWeightedRevenuePage', 'WR (page)'),
          value: formatMoney(weighted, 'EUR'),
        },
        {
          label: t('oppToolbar.kpiOpenPage', 'Open (page)'),
          value: formatMoney(
            openOpps.reduce((acc, o) => acc + o.value, 0),
            'EUR',
          ),
        },
      ];
  return (
    <div
      role="region"
      aria-label={t('oppToolbar.kpiRegionLabel', 'Opportunities KPI summary')}
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
  const { t } = useTranslation('crm');
  const clearBtnClass =
    'ml-2 rounded text-xs text-[var(--fg-tertiary)] underline hover:text-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]';

  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="gradient-text text-2xl font-bold tracking-tight text-[var(--fg-primary)]">
          {t('oppToolbar.title', 'Opportunities')}
        </h1>
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
                stage: formatStage(stageFilter).toLowerCase(),
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
        <Button size="sm" variant="ghost" onClick={onClearSelection} disabled={isPending}>
          {t('oppToolbar.clearSelection', 'Clear')}
        </Button>
      </div>
    </div>
  );
}
