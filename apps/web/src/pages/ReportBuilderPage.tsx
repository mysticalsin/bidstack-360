// ReportBuilderPage — the report authoring surface wired to /reports/new and
// /reports/:id/edit. Assembles the (previously orphaned) FilterBuilder,
// AggregatePicker, GroupByPicker primitives + a chart-type picker, a live
// preview (POST /reports/run), and save via useCreateReport / useUpdateReport.
// Edit mode hydrates from a fetched report via the keyed-remount pattern
// (no effect-driven setState).

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, ArrowLeft, Play, Trash2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { FilterBuilder } from '@/components/reports/FilterBuilder';
import { AggregatePicker } from '@/components/reports/AggregatePicker';
import { GroupByPicker } from '@/components/reports/GroupByPicker';
import { FieldPicker } from '@/components/reports/FieldPicker';
import { ReportPreview } from '@/components/reports/ReportPreview';
import { buildQuery, outputAliases } from '@/lib/reportQuery';
import {
  useAnalyticsReport,
  useCreateReport,
  usePreviewReport,
  useUpdateReport,
  type Aggregate,
  type ChartType,
  type FilterGroup,
  type GroupBy,
  type Report,
  type ReportEntityType,
  type SortField,
} from '@/hooks/useAnalyticsReports';

const ENTITIES: { value: ReportEntityType; label: string }[] = [
  { value: 'opportunity', label: 'Opportunities' },
  { value: 'lead', label: 'Leads' },
  { value: 'contact', label: 'Contacts' },
  { value: 'company', label: 'Companies' },
  { value: 'task', label: 'Tasks' },
  { value: 'activity', label: 'Activities' },
  { value: 'goal', label: 'Forecasts' },
];

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'table', label: 'Table' },
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'pie', label: 'Pie' },
  { value: 'donut', label: 'Donut' },
  { value: 'funnel', label: 'Funnel' },
  { value: 'gauge', label: 'Gauge' },
  { value: 'heatmap', label: 'Heatmap' },
  { value: 'radar', label: 'Radar' },
  // 'scatter' is a valid engine chartType but the preview has no {x,y} adapter
  // yet, so it is intentionally omitted from the picker (no silent table swap).
];

const inputCls = cn(
  'w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)]',
  'px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)]',
  'focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] min-h-[44px]',
);

// ── Builder form (seeded once from `initial`; remounted on hydrate) ───────────

function BuilderForm({ initial, reportId }: { initial: Report | null; reportId: string | null }) {
  const { t } = useTranslation('reports');
  const navigate = useNavigate();
  const create = useCreateReport();
  const update = useUpdateReport(reportId ?? '');
  const preview = usePreviewReport();

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [entity, setEntity] = useState<ReportEntityType>(initial?.query.entity ?? 'opportunity');
  const [filters, setFilters] = useState<FilterGroup>(
    initial?.query.filters ?? { logic: 'AND', conditions: [] },
  );
  const [aggregates, setAggregates] = useState<Aggregate[]>(initial?.query.aggregates ?? []);
  const [groupBy, setGroupBy] = useState<GroupBy[]>(initial?.query.groupBy ?? []);
  const [sort, setSort] = useState<SortField[]>(initial?.query.sort ?? []);
  const [limit, setLimit] = useState<number>(initial?.query.limit ?? 100);
  const [chartType, setChartType] = useState<ChartType>(initial?.chartType ?? 'table');

  const query = useMemo(
    () => buildQuery({ entity, filters, aggregates, groupBy, sort, limit }),
    [entity, filters, aggregates, groupBy, sort, limit],
  );
  const aliases = useMemo(() => outputAliases(aggregates, groupBy), [aggregates, groupBy]);

  const saving = create.isPending || update.isPending;

  function runPreview() {
    preview.mutate(query, {
      onError: (err) =>
        toast.error(t('reportBuilder.toast.previewFailed', 'Preview failed'), {
          description: (err as Error).message,
        }),
    });
  }

  function save() {
    if (!name.trim()) {
      toast.error(t('reportBuilder.toast.nameRequired', 'Name your report before saving.'));
      return;
    }
    const body = { name: name.trim(), description: description.trim() || undefined, query, chartType };
    const opts = {
      onSuccess: () => {
        toast.success(
          reportId
            ? t('reportBuilder.toast.updated', 'Report updated')
            : t('reportBuilder.toast.created', 'Report created'),
        );
        navigate('/reports/list');
      },
      onError: (err: unknown) =>
        toast.error(t('reportBuilder.toast.saveFailed', 'Could not save'), {
          description: (err as Error).message,
        }),
    };
    if (reportId) update.mutate(body, opts);
    else create.mutate(body, opts);
  }

  // Switching entity invalidates field-specific config — reset query parts.
  function onEntityChange(next: ReportEntityType) {
    setEntity(next);
    setFilters({ logic: 'AND', conditions: [] });
    setAggregates([]);
    setGroupBy([]);
    setSort([]);
  }

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/reports/list')}
          aria-label={t('reportBuilder.backToReports', 'Back to reports')}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--fg-primary)]">
            {reportId
              ? t('reportBuilder.title.edit', 'Edit report')
              : t('reportBuilder.title.new', 'New report')}
          </h1>
          <p className="mt-0.5 text-sm text-[var(--fg-tertiary)]">
            {t('reportBuilder.subtitle', 'Compose a query, preview it live, then save.')}
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className={cn(
            'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white',
            'bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] transition-colors',
            'min-h-[44px] disabled:opacity-50',
          )}
        >
          <Save size={16} />
          {saving
            ? t('reportBuilder.saveButton.saving', 'Saving…')
            : reportId
              ? t('reportBuilder.saveButton.saveChanges', 'Save changes')
              : t('reportBuilder.saveButton.create', 'Create report')}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ── Left: builder controls ── */}
        <div className="space-y-5">
          <Card>
            <SectionHeader title={t('reportBuilder.details.title', 'Report details')} />
            <div className="space-y-3 p-5">
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--fg-primary)]">
                  {t('reportBuilder.details.nameLabel', 'Name')}
                </label>
                <input
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('reportBuilder.details.namePlaceholder', 'e.g. Won deals by month')}
                  aria-label={t('reportBuilder.details.nameAria', 'Report name')}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--fg-primary)]">
                  {t('reportBuilder.details.descriptionLabel', 'Description')}
                </label>
                <input
                  className={inputCls}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('reportBuilder.details.descriptionPlaceholder', 'Optional')}
                  aria-label={t('reportBuilder.details.descriptionAria', 'Report description')}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--fg-primary)]">
                  {t('reportBuilder.details.dataSourceLabel', 'Data source')}
                </label>
                <select
                  className={inputCls}
                  value={entity}
                  onChange={(e) => onEntityChange(e.target.value as ReportEntityType)}
                  aria-label={t('reportBuilder.details.dataSourceAria', 'Report entity')}
                >
                  {ENTITIES.map((e) => (
                    <option key={e.value} value={e.value}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          <Card>
            <SectionHeader
              title={t('reportBuilder.filters.title', 'Filters')}
              caption={t('reportBuilder.filters.caption', 'Limit which records are included.')}
            />
            <div className="p-5">
              <FilterBuilder entity={entity} value={filters} onChange={setFilters} />
            </div>
          </Card>

          <Card>
            <SectionHeader
              title={t('reportBuilder.measures.title', 'Measures')}
              caption={t('reportBuilder.measures.caption', 'Aggregate values (leave empty to list rows).')}
            />
            <div className="p-5">
              <AggregatePicker entity={entity} aggregates={aggregates} onChange={setAggregates} />
            </div>
          </Card>

          <Card>
            <SectionHeader
              title={t('reportBuilder.groupBy.title', 'Group by')}
              caption={t('reportBuilder.groupBy.caption', 'Break measures down by dimension.')}
            />
            <div className="p-5">
              <GroupByPicker entity={entity} groupBy={groupBy} onChange={setGroupBy} />
            </div>
          </Card>

          <Card>
            <SectionHeader title={t('reportBuilder.sortLimit.title', 'Sort & limit')} />
            <div className="space-y-3 p-5">
              <SortEditor entity={entity} aliases={aliases} sort={sort} onChange={setSort} />
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--fg-primary)]">
                  {t('reportBuilder.sortLimit.rowLimitLabel', 'Row limit')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  className={cn(inputCls, 'max-w-[8rem]')}
                  // `limit || ''` lets the field be cleared while typing instead of
                  // snapping to 1 on every keystroke; blur restores a sane default.
                  value={limit || ''}
                  onChange={(e) =>
                    setLimit(Math.min(1000, Math.max(0, Math.trunc(Number(e.target.value) || 0))))
                  }
                  onBlur={() => {
                    if (!limit) setLimit(100);
                  }}
                  aria-label={t('reportBuilder.sortLimit.rowLimitAria', 'Row limit')}
                />
              </div>
            </div>
          </Card>

          <Card>
            <SectionHeader title={t('reportBuilder.visualization.title', 'Visualization')} />
            <div className="p-5">
              <select
                className={cn(inputCls, 'max-w-[14rem]')}
                value={chartType}
                onChange={(e) => setChartType(e.target.value as ChartType)}
                aria-label={t('reportBuilder.visualization.chartTypeAria', 'Chart type')}
              >
                {CHART_TYPES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </Card>
        </div>

        {/* ── Right: live preview (sticky) ── */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <button
            type="button"
            onClick={runPreview}
            disabled={preview.isPending}
            className={cn(
              'mb-3 flex items-center gap-2 rounded-lg border border-[var(--border-default)] px-4 py-2',
              'text-sm font-medium text-[var(--fg-primary)] hover:bg-[var(--surface-sunken)] transition-colors',
              'min-h-[44px] disabled:opacity-50',
            )}
          >
            <Play size={15} />
            {preview.isPending
              ? t('reportBuilder.preview.running', 'Running…')
              : t('reportBuilder.preview.run', 'Run preview')}
          </button>
          <ReportPreview
            chartType={chartType}
            query={query}
            run={preview.data ?? null}
            isLoading={preview.isPending}
            error={preview.isError ? (preview.error as Error).message : null}
            onRun={runPreview}
          />
        </div>
      </div>
    </div>
  );
}

// ── Sort editor (small, local) ────────────────────────────────────────────────

function SortEditor({
  entity,
  aliases,
  sort,
  onChange,
}: {
  entity: ReportEntityType;
  aliases: string[];
  sort: SortField[];
  onChange: (s: SortField[]) => void;
}) {
  const { t } = useTranslation('reports');
  const selectCls = cn(
    'rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)]',
    'px-2 py-1.5 text-sm text-[var(--fg-primary)]',
    'focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] min-h-[44px]',
  );
  const update = (i: number, patch: Partial<SortField>) =>
    onChange(sort.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-[var(--fg-primary)]">
        {t('reportBuilder.sort.label', 'Sort')}
      </label>
      {sort.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          {aliases.length > 0 ? (
            <select
              className={cn(selectCls, 'flex-1')}
              value={s.field}
              onChange={(e) => update(i, { field: e.target.value })}
              aria-label={t('reportBuilder.sort.fieldAria', 'Sort field')}
            >
              <option value="">{t('reportBuilder.sort.pickColumn', 'Pick column…')}</option>
              {aliases.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          ) : (
            // Plain row selects emit raw column keys — let the user pick a field.
            <div className="flex-1">
              <FieldPicker
                entity={entity}
                value={s.field}
                onChange={(key) => update(i, { field: key })}
                placeholder={t('reportBuilder.sort.pickColumn', 'Pick column…')}
              />
            </div>
          )}
          <select
            className={selectCls}
            value={s.dir}
            onChange={(e) => update(i, { dir: e.target.value as 'asc' | 'desc' })}
            aria-label={t('reportBuilder.sort.directionAria', 'Sort direction')}
          >
            <option value="asc">{t('reportBuilder.sort.ascending', 'Ascending')}</option>
            <option value="desc">{t('reportBuilder.sort.descending', 'Descending')}</option>
          </select>
          <button
            type="button"
            onClick={() => onChange(sort.filter((_, idx) => idx !== i))}
            aria-label={t('reportBuilder.sort.removeAria', 'Remove sort')}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[var(--fg-tertiary)] hover:bg-[var(--danger-tint)] hover:text-[var(--danger)]"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {sort.length < 5 && (
        <button
          type="button"
          onClick={() => onChange([...sort, { field: '', dir: 'desc' }])}
          className="min-h-[44px] rounded px-2 text-xs text-[var(--brand-primary)] hover:underline"
        >
          {t('reportBuilder.sort.add', '+ Add sort')}
        </button>
      )}
    </div>
  );
}

// ── Page (handles create vs hydrate-on-edit) ──────────────────────────────────

export function ReportBuilderPage() {
  const { id } = useParams<{ id?: string }>();

  if (!id) return <BuilderForm initial={null} reportId={null} />;
  return <EditLoader id={id} />;
}

function EditLoader({ id }: { id: string }) {
  const { t } = useTranslation('reports');
  const { data, isLoading, error } = useAnalyticsReport(id);
  if (isLoading) {
    return (
      <div className="p-8">
        <LoadingSkeleton rows={6} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-8">
        <ErrorState
          title={t('reportBuilder.error.notFoundTitle', 'Report not found')}
          message={(error as Error)?.message ?? t('reportBuilder.error.notFoundMessage', 'It may have been deleted.')}
        />
      </div>
    );
  }
  // Keyed remount: seed all form state from `data` once; no effect-driven setState.
  return <BuilderForm key={data.id} initial={data} reportId={id} />;
}
