// FieldPicker — combobox showing fields available for a given entity type.
// Field metadata is fetched from /api/entities/:type/fields.
// Falls back to a hard-coded schema when the endpoint is unavailable.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Search } from 'lucide-react';

import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import type { ReportEntityType } from '@/hooks/useAnalyticsReports';

interface FieldDef {
  key: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'enum';
  enumValues?: string[];
}

// Hard-coded fallback schema per entity — keeps UI functional without the endpoint.
const FALLBACK_FIELDS: Record<ReportEntityType, FieldDef[]> = {
  lead: [
    { key: 'status', label: 'Status', type: 'enum', enumValues: ['new', 'contacted', 'qualified', 'disqualified', 'converted'] },
    { key: 'source', label: 'Source', type: 'string' },
    { key: 'score', label: 'Score', type: 'number' },
    { key: 'createdAt', label: 'Created', type: 'date' },
  ],
  opportunity: [
    { key: 'stage', label: 'Stage', type: 'string' },
    { key: 'valueMicros', label: 'Value', type: 'number' },
    { key: 'probability', label: 'Probability', type: 'number' },
    { key: 'dueDate', label: 'Due date', type: 'date' },
    { key: 'customer', label: 'Customer', type: 'string' },
  ],
  contact: [
    { key: 'name', label: 'Name', type: 'string' },
    { key: 'email', label: 'Email', type: 'string' },
    { key: 'role', label: 'Role', type: 'string' },
    { key: 'createdAt', label: 'Created', type: 'date' },
  ],
  company: [
    { key: 'name', label: 'Name', type: 'string' },
    { key: 'industry', label: 'Industry', type: 'string' },
    { key: 'size', label: 'Size', type: 'string' },
    { key: 'createdAt', label: 'Created', type: 'date' },
  ],
  task: [
    { key: 'status', label: 'Status', type: 'enum', enumValues: ['todo', 'in_progress', 'done', 'cancelled'] },
    { key: 'priority', label: 'Priority', type: 'enum', enumValues: ['low', 'medium', 'high', 'urgent'] },
    { key: 'dueDate', label: 'Due date', type: 'date' },
    { key: 'createdAt', label: 'Created', type: 'date' },
  ],
  activity: [
    { key: 'type', label: 'Type', type: 'string' },
    { key: 'occurredAt', label: 'Date', type: 'date' },
    { key: 'actorType', label: 'Actor type', type: 'string' },
  ],
  goal: [
    { key: 'metric', label: 'Metric', type: 'string' },
    { key: 'status', label: 'Status', type: 'string' },
    { key: 'period', label: 'Period', type: 'string' },
    { key: 'endDate', label: 'End date', type: 'date' },
  ],
};

interface Props {
  entity: ReportEntityType;
  value: string;
  onChange: (field: string, fieldDef: FieldDef) => void;
  placeholder?: string;
  className?: string;
}

export function FieldPicker({ entity, value, onChange, placeholder, className }: Props) {
  const { t } = useTranslation('reports');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const resolvedPlaceholder = placeholder ?? t('fieldPicker.placeholder', 'Pick a field…');

  const { data: remoteFields } = useQuery<FieldDef[]>({
    queryKey: ['entity-fields', entity],
    queryFn: () => api<FieldDef[]>(`/api/entities/${entity}/fields`),
    staleTime: Infinity,
    // Don't throw on error — fall back to local
    retry: false,
  });

  // WHY useMemo on `fields`: the `remoteFields ?? FALLBACK ?? []` expression
  // creates a fresh `[]` literal on every render when both sides are null,
  // which busts the downstream `useMemo([fields, query])` deps and re-runs
  // the filter every render. Memoizing on the explicit inputs prevents that.
  const fields = useMemo(
    () => remoteFields ?? FALLBACK_FIELDS[entity] ?? [],
    [remoteFields, entity],
  );

  const filtered = useMemo(
    () => fields.filter((f) => f.label.toLowerCase().includes(query.toLowerCase()) || f.key.includes(query.toLowerCase())),
    [fields, query],
  );

  const selectedField = fields.find((f) => f.key === value);

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--border-default)]',
          'bg-[var(--surface-card)] px-3 py-2 text-sm transition-colors',
          'text-[var(--fg-primary)] hover:border-[var(--border-strong)]',
          'focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]',
          'min-h-[44px]',
        )}
      >
        <span className={selectedField ? '' : 'text-[var(--fg-tertiary)]'}>
          {selectedField?.label ?? resolvedPlaceholder}
        </span>
        <ChevronDown size={14} className="text-[var(--fg-tertiary)] shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t('fieldPicker.listboxLabel', 'Field options')}
          className={cn(
            'absolute left-0 top-full mt-1 z-20 w-full max-h-52 overflow-y-auto rounded-lg',
            'border border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-md)]',
          )}
        >
          <div className="sticky top-0 bg-[var(--surface-card)] px-2 py-1.5 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-1.5">
              <Search size={12} className="text-[var(--fg-tertiary)]" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('fieldPicker.searchPlaceholder', 'Search fields…')}
                className="flex-1 bg-transparent text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] outline-none"
              />
            </div>
          </div>
          {filtered.length === 0 && (
            <p className="px-3 py-3 text-xs text-[var(--fg-tertiary)]">{t('fieldPicker.empty', 'No fields found.')}</p>
          )}
          {filtered.map((f) => (
            <button
              key={f.key}
              role="option"
              aria-selected={f.key === value}
              onClick={() => {
                onChange(f.key, f);
                setOpen(false);
                setQuery('');
              }}
              className={cn(
                'flex w-full items-center justify-between px-3 py-2 text-sm transition-colors min-h-[40px]',
                f.key === value
                  ? 'bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]'
                  : 'text-[var(--fg-primary)] hover:bg-[var(--surface-sunken)]',
              )}
            >
              <span>{f.label}</span>
              <span className="text-[10px] text-[var(--fg-tertiary)] uppercase tracking-wide">
                {f.type}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type { FieldDef };
