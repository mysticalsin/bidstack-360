// FieldPicker: combobox of fields for one entity type.
// The catalog comes from /api/entities/:type/fields.
// An unread or failed read does not substitute a hard-coded schema.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Search } from 'lucide-react';

import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import type { ReportEntityType } from '@/hooks/useAnalyticsReports';

import { fieldListPhase } from './field-list-read';

interface FieldDef {
  key: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'enum';
  enumValues?: string[];
}

interface Props {
  entity: ReportEntityType;
  value: string;
  onChange: (field: string, fieldDef: FieldDef) => void;
  // WHY onResolve: on the edit path a saved condition arrives with `value` set
  // but the parent has no FieldDef yet, so it can't render the correct
  // operators/value-input. This fires once the field metadata resolves for the
  // current `value`, letting the parent hydrate the field TYPE without the user
  // re-selecting the field.
  onResolve?: (fieldDef: FieldDef) => void;
  placeholder?: string;
  className?: string;
}

export function FieldPicker({ entity, value, onChange, onResolve, placeholder, className }: Props) {
  const { t } = useTranslation('reports');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const resolvedPlaceholder = placeholder ?? t('fieldPicker.placeholder', 'Pick a field…');

  const fieldQuery = useQuery<FieldDef[]>({
    queryKey: ['entity-fields', entity],
    queryFn: () => api<FieldDef[]>(`/api/entities/${entity}/fields`),
    staleTime: Infinity,
    retry: false,
  });
  const phase = fieldListPhase({
    data: fieldQuery.data,
    isError: fieldQuery.isError,
    status: fieldQuery.status,
  });

  // WHY useMemo on `fields`: an unread or failed read must not keep a new
  // empty array identity on every render. That would bust the filter memo.
  const fields = useMemo(
    () => (phase === 'ready' ? fieldQuery.data ?? [] : []),
    [phase, fieldQuery.data],
  );

  const filtered = useMemo(
    () => fields.filter((f) => f.label.toLowerCase().includes(query.toLowerCase()) || f.key.includes(query.toLowerCase())),
    [fields, query],
  );

  const selectedField = fields.find((f) => f.key === value);

  // Notify the parent of the resolved FieldDef for the current `value` so the
  // edit path can hydrate the field type before the user interacts (see Props).
  useEffect(() => {
    if (selectedField) onResolve?.(selectedField);
  }, [selectedField, onResolve]);

  const statusClass = cn(
    'flex min-h-11 items-center px-3 text-sm text-[var(--fg-secondary)]',
    className,
  );
  if (phase === 'failed') {
    return (
      <p role="alert" className={statusClass}>
        {t('fieldPicker.loadError', 'Could not load fields.')}
      </p>
    );
  }
  if (phase === 'unread') {
    return (
      <p role="status" className={statusClass}>
        {t('fieldPicker.checking', 'Checking fields. The list has not arrived.')}
      </p>
    );
  }

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
                  ? 'bg-[var(--brand-primary-tint)] text-[var(--brand-primary)] dark:text-[var(--brand-deep)]'
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
