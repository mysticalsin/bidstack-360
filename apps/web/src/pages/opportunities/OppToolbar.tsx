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
import { closedOutcome } from '@/lib/pipeline-stages';
import { useTranslation } from 'react-i18next';

import { formatMicrosAmount, type Opportunity, type PipelineStage } from '@bidstack/shared';

// ── OppKpiBar ─────────────────────────────────────────────────────────────────

/**
 * Headline KPIs. Tenant-wide counts/pipeline come from the server aggregate
 * (`/api/crm/summary`) so they reflect the whole org, not just the current 50-row
 * cursor page — at 100k-company scale a page-derived total under-reports the
 * pipeline by orders of magnitude. The weighted figure has no server aggregate,
 * so it stays page-derived and is labelled "(page)". It is value × stored
 * stage probability for open rows on this page.
 */
function dealMicros(opp: Opportunity): bigint {
  if (opp.valueMicros != null && /^\d+$/.test(opp.valueMicros)) return BigInt(opp.valueMicros);
  return BigInt(Math.round(opp.value * 1_000_000));
}

function sumDealMicros(rows: Opportunity[], weight: boolean): bigint {
  return rows.reduce((sum, opp) => {
    const micros = dealMicros(opp);
    if (!weight) return sum + micros;
    if (opp.probability <= 0) return sum;
    return sum + (micros * BigInt(opp.probability)) / 100n;
  }, 0n);
}

export function OppKpiBar({ opps, summary }: { opps: Opportunity[]; summary?: OrgSummary }) {
  const { t } = useTranslation('crm');
  const openOpps = opps.filter((o) => closedOutcome(o) === null);
  const wonMicros = sumDealMicros(
    opps.filter((o) => closedOutcome(o) === 'won'),
    false,
  );
  const weightedMicros = sumDealMicros(openOpps, true);
  const openMicros = sumDealMicros(openOpps, false);
  const currencyDetail = t('oppToolbar.kpiCurrencyBasis', UNSPECIFIED_CURRENCY_BASIS);
  const weightedDetail = t(
    'oppToolbar.kpiWeightedRevenueDetail',
    'Open rows on this page × stored probability. {{basis}}',
    { basis: UNSPECIFIED_CURRENCY_BASIS },
  );
  const kpis: Array<{ label: string; value: string; detail?: string }> = summary
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
          value: summary.pipelineValueMicros
            ? formatMicrosAmount(BigInt(summary.pipelineValueMicros))
            : formatUnspecifiedAmount(summary.pipelineValue),
          detail: currencyDetail,
        },
        {
          label: t('oppToolbar.kpiWeightedRevenuePage', 'Weighted (page)'),
          value: formatMicrosAmount(weightedMicros),
          detail: weightedDetail,
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
          label: t('oppToolbar.kpiRevenuePage', 'Won (page)'),
          value: formatMicrosAmount(wonMicros),
          detail: currencyDetail,
        },
        {
          label: t('oppToolbar.kpiWeightedRevenuePage', 'Weighted (page)'),
          value: formatMicrosAmount(weightedMicros),
          detail: weightedDetail,
        },
        {
          label: t('oppToolbar.kpiOpenPage', 'Open (page)'),
          value: formatMicrosAmount(openMicros),
          detail: currencyDetail,
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
          {kpi.detail ? (
            <div className="mt-0.5 text-[11px] leading-snug text-[var(--fg-tertiary)]">{kpi.detail}</div>
          ) : null}
        </div>
      ))}
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
    'ml-2 rounded text-xs text-[var(--fg-tertiary)] underline hover:text-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]';

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
              {t('oppToolbar.bidsInFlight', '{{count}} on this page · click any cell to edit inline.', {
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
