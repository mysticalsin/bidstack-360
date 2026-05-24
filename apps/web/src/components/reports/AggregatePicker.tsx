// AggregatePicker — select an aggregate function + field.
// Used in ReportBuilderPage to configure SELECT aggregates.

import { Trash2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import type { Aggregate, AggregateFunction, ReportEntityType } from '@/hooks/useAnalyticsReports';
import { FieldPicker } from './FieldPicker';

const FUNCTIONS: { fn: AggregateFunction; label: string }[] = [
  { fn: 'COUNT', label: 'Count' },
  { fn: 'COUNT_DISTINCT', label: 'Count distinct' },
  { fn: 'SUM', label: 'Sum' },
  { fn: 'AVG', label: 'Average' },
  { fn: 'MIN', label: 'Min' },
  { fn: 'MAX', label: 'Max' },
];

interface Props {
  entity: ReportEntityType;
  aggregates: Aggregate[];
  onChange: (aggs: Aggregate[]) => void;
}

export function AggregatePicker({ entity, aggregates, onChange }: Props) {
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
            aria-label="Aggregate function"
            className={selectCls}
          >
            {FUNCTIONS.map((f) => (
              <option key={f.fn} value={f.fn}>
                {f.label}
              </option>
            ))}
          </select>

          {/* Field picker — not shown for bare COUNT(*) */}
          {agg.fn !== 'COUNT' && (
            <FieldPicker
              entity={entity}
              value={agg.field}
              onChange={(key) => update(i, { field: key })}
              placeholder="Pick field…"
              className="flex-1"
            />
          )}

          {/* Alias */}
          <input
            type="text"
            value={agg.alias ?? ''}
            onChange={(e) => update(i, { alias: e.target.value })}
            placeholder="Alias (optional)"
            className={cn(selectCls, 'flex-1')}
            aria-label="Aggregate alias"
          />

          <button
            onClick={() => remove(i)}
            aria-label="Remove aggregate"
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
        + Add aggregate
      </button>
    </div>
  );
}
