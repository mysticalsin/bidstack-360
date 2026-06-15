// AggregatePicker — select an aggregate function + field.
// Used in ReportBuilderPage to configure SELECT aggregates.

import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import type { Aggregate, AggregateFunction, ReportEntityType } from '@/hooks/useAnalyticsReports';
import { FieldPicker } from './FieldPicker';

const FUNCTIONS: { fn: AggregateFunction; labelKey: string; labelDefault: string }[] = [
  { fn: 'COUNT', labelKey: 'aggregatePicker.functionCount', labelDefault: 'Count' },
  { fn: 'COUNT_DISTINCT', labelKey: 'aggregatePicker.functionCountDistinct', labelDefault: 'Count distinct' },
  { fn: 'SUM', labelKey: 'aggregatePicker.functionSum', labelDefault: 'Sum' },
  { fn: 'AVG', labelKey: 'aggregatePicker.functionAverage', labelDefault: 'Average' },
  { fn: 'MIN', labelKey: 'aggregatePicker.functionMin', labelDefault: 'Min' },
  { fn: 'MAX', labelKey: 'aggregatePicker.functionMax', labelDefault: 'Max' },
];

interface Props {
  entity: ReportEntityType;
  aggregates: Aggregate[];
  onChange: (aggs: Aggregate[]) => void;
}

export function AggregatePicker({ entity, aggregates, onChange }: Props) {
  const { t } = useTranslation('reports');

  const add = () => {
    onChange([...aggregates, { fn: 'COUNT', field: '*', alias: '' }]);
  };

  const update = (i: number, patch: Partial<Aggregate>) => {
    const next = aggregates.map((a, idx) => (idx === i ? { ...a, ...patch } : a));
    onChange(next);
  };

  const remove = (i: number) => {
    onChange(aggregates.filter((_, idx) => idx !== i));
  };

  const selectCls = cn(
    'rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)]',
    'px-2 py-1.5 text-sm text-[var(--fg-primary)]',
    'focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]',
    'min-h-[44px]',
  );

  return (
    <div className="space-y-2">
      {aggregates.map((agg, i) => (
        <div key={i} className="flex items-center gap-2">
          {/* Function selector */}
          <select
            value={agg.fn}
            onChange={(e) => update(i, { fn: e.target.value as AggregateFunction })}
            aria-label={t('aggregatePicker.functionAriaLabel', 'Aggregate function')}
            className={selectCls}
          >
            {FUNCTIONS.map((f) => (
              <option key={f.fn} value={f.fn}>
                {t(f.labelKey, f.labelDefault)}
              </option>
            ))}
          </select>

          {/* Field picker — not shown for bare COUNT(*) */}
          {agg.fn !== 'COUNT' && (
            <FieldPicker
              entity={entity}
              value={agg.field}
              onChange={(key) => update(i, { field: key })}
              placeholder={t('aggregatePicker.fieldPlaceholder', 'Pick field…')}
              className="flex-1"
            />
          )}

          {/* Alias */}
          <input
            type="text"
            value={agg.alias ?? ''}
            onChange={(e) => update(i, { alias: e.target.value })}
            placeholder={t('aggregatePicker.aliasPlaceholder', 'Alias (optional)')}
            className={cn(selectCls, 'flex-1')}
            aria-label={t('aggregatePicker.aliasAriaLabel', 'Aggregate alias')}
          />

          <button
            onClick={() => remove(i)}
            aria-label={t('aggregatePicker.removeAriaLabel', 'Remove aggregate')}
            className={cn(
              'flex items-center justify-center w-8 h-8 rounded-lg text-[var(--fg-tertiary)]',
              'hover:text-[var(--danger)] hover:bg-[var(--danger-tint)] transition-colors',
              'min-w-[44px] min-h-[44px]',
            )}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      <button
        onClick={add}
        className={cn(
          'text-xs text-[var(--brand-primary)] hover:underline',
          'focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] rounded px-1',
          'min-h-[44px] px-2',
        )}
      >
        {t('aggregatePicker.addButton', '+ Add aggregate')}
      </button>
    </div>
  );
}
