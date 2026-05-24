// GroupByPicker — select fields to group by, with optional time bucketing.

import { Trash2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import type { GroupBy, ReportEntityType, TimeBucket } from '@/hooks/useAnalyticsReports';
import { FieldPicker } from './FieldPicker';

const TIME_BUCKETS: { bucket: TimeBucket; label: string }[] = [
  { bucket: 'DAY', label: 'Day' },
  { bucket: 'WEEK', label: 'Week' },
  { bucket: 'MONTH', label: 'Month' },
  { bucket: 'QUARTER', label: 'Quarter' },
  { bucket: 'YEAR', label: 'Year' },
];

interface Props {
  entity: ReportEntityType;
  groupBy: GroupBy[];
  onChange: (groupBy: GroupBy[]) => void;
}

export function GroupByPicker({ entity, groupBy, onChange }: Props) {
  const add = () => {
    onChange([...groupBy, { field: '' }]);
  };

  const update = (i: number, patch: Partial<GroupBy>) => {
    onChange(groupBy.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  };

  const remove = (i: number) => {
    onChange(groupBy.filter((_, idx) => idx !== i));
  };

  const selectCls = cn(
    'rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)]',
    'px-2 py-1.5 text-sm text-[var(--fg-primary)]',
    'focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]',
    'min-h-[44px]',
  );

  return (
    <div className="space-y-2">
      {groupBy.map((g, i) => (
        <div key={i} className="flex items-center gap-2">
          <FieldPicker
            entity={entity}
            value={g.field}
            onChange={(key) => update(i, { field: key })}
            placeholder="Pick field…"
            className="flex-1"
          />
          {/* Time bucket — only shown after field selected */}
          {g.field && (
            <select
              value={g.timeBucket ?? ''}
              onChange={(e) =>
                update(i, { timeBucket: (e.target.value as TimeBucket) || undefined })
              }
              aria-label="Time bucket"
              className={selectCls}
            >
              <option value="">No time bucket</option>
              {TIME_BUCKETS.map((b) => (
                <option key={b.bucket} value={b.bucket}>
                  {b.label}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => remove(i)}
            aria-label="Remove group-by field"
            className={cn(
              'flex items-center justify-center rounded-lg text-[var(--fg-tertiary)]',
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
          'focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] rounded px-2',
          'min-h-[44px]',
        )}
      >
        + Add group by
      </button>
    </div>
  );
}
