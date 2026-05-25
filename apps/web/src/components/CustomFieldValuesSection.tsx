import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { Card, SectionHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import {
  useCustomFieldDefinitions,
  useCustomFieldValues,
  useUpsertCustomFieldValues,
} from '@/hooks/useCustomFields';
import type { EntityType, FieldType } from '@bidstack/shared';

interface CustomFieldValuesSectionProps {
  entityType: EntityType;
  entityId: string;
}

const QUERY_KEYS: Record<EntityType, string> = {
  company: 'company',
  contact: 'contact',
  opportunity: 'opportunity',
  lead: 'leads',
  task: 'tasks',
  invoice: 'invoice',
};

export function CustomFieldValuesSection({ entityType, entityId }: CustomFieldValuesSectionProps) {
  const defs = useCustomFieldDefinitions(entityType);
  const values = useCustomFieldValues(entityType, entityId);
  const upsert = useUpsertCustomFieldValues();
  const qc = useQueryClient();

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (values.data) {
      const map: Record<string, unknown> = {};
      values.data.items.forEach((v) => {
        map[v.definitionId] = v.value;
      });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizes editable draft from fetched field values.
      setDraft(map);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetched values are now the clean baseline.
      setHasChanges(false);
    }
  }, [values.data]);

  const handleChange = useCallback((definitionId: string, value: unknown) => {
    setDraft((prev) => ({ ...prev, [definitionId]: value }));
    setHasChanges(true);
  }, []);

  const handleSave = () => {
    const payload: Record<string, unknown> = {};
    defs.data?.items.forEach((d) => {
      if (draft[d.id] !== undefined) {
        payload[d.id] = draft[d.id];
      }
    });

    upsert.mutate(
      { entityType, entityId, values: payload },
      {
        onSuccess: () => {
          toast.success('Custom fields saved');
          setHasChanges(false);
          // Invalidate parent detail query so the page reflects the change
          const parentKey = QUERY_KEYS[entityType];
          if (parentKey === 'tasks') {
            void qc.invalidateQueries({ queryKey: [parentKey] });
          } else {
            void qc.invalidateQueries({ queryKey: [parentKey, entityId] });
          }
        },
        onError: () => {
          toast.error('Failed to save custom fields');
        },
      },
    );
  };

  if (defs.isLoading || values.isLoading) {
    return (
      <Card>
        <SectionHeader title="Custom Fields" />
        <div className="p-5 space-y-3">
          <div className="h-4 w-1/3 bg-[var(--surface-sunken)] animate-pulse rounded" />
          <div className="h-8 w-full bg-[var(--surface-sunken)] animate-pulse rounded" />
          <div className="h-4 w-1/3 bg-[var(--surface-sunken)] animate-pulse rounded" />
          <div className="h-8 w-full bg-[var(--surface-sunken)] animate-pulse rounded" />
        </div>
      </Card>
    );
  }

  const activeDefs = defs.data?.items ?? [];

  if (activeDefs.length === 0) {
    return null;
  }

  return (
    <Card>
      <SectionHeader title="Custom Fields" caption={`${activeDefs.length} defined`} />
      <div className="p-5 space-y-4">
        {activeDefs.map((def) => (
          <FieldInput
            key={def.id}
            definition={def}
            value={draft[def.id]}
            onChange={(value) => handleChange(def.id, value)}
          />
        ))}
        {hasChanges && (
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const map: Record<string, unknown> = {};
                values.data?.items.forEach((v) => {
                  map[v.definitionId] = v.value;
                });
                setDraft(map);
                setHasChanges(false);
              }}
            >
              Reset
            </Button>
            <Button size="sm" onClick={handleSave} disabled={upsert.isPending}>
              {upsert.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function FieldInput({
  definition,
  value,
  onChange,
}: {
  definition: {
    id: string;
    label: string;
    fieldType: FieldType;
    options: string[];
    required: boolean;
  };
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { label, fieldType, options, required } = definition;

  const baseClass =
    'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20';

  return (
    <div>
      <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
        {label}
        {required && <span className="text-[var(--danger)] ml-0.5">*</span>}
      </label>
      {fieldType === 'text' && (
        <input
          type="text"
          className={baseClass}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {fieldType === 'number' && (
        <input
          type="number"
          className={baseClass}
          value={(value as number) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      )}
      {fieldType === 'date' && (
        <input
          type="date"
          className={baseClass}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      )}
      {fieldType === 'boolean' && (
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-[var(--border-subtle)] text-[var(--brand-primary)] focus:ring-[var(--brand-primary)]"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      )}
      {fieldType === 'select' && (
        <select
          className={baseClass}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">—</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}
      {fieldType === 'multi_select' && (
        <div className="space-y-1">
          {options.map((opt) => {
            const selected = Array.isArray(value) ? (value as string[]) : [];
            return (
              <label key={opt} className="flex items-center gap-2 text-sm text-[var(--fg-secondary)]">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-[var(--border-subtle)] text-[var(--brand-primary)] focus:ring-[var(--brand-primary)]"
                  checked={selected.includes(opt)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, opt]
                      : selected.filter((s) => s !== opt);
                    onChange(next);
                  }}
                />
                {opt}
              </label>
            );
          })}
        </div>
      )}
      {fieldType === 'currency' && (
        <input
          type="number"
          step="0.01"
          className={baseClass}
          value={(value as number) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      )}
      {fieldType === 'url' && (
        <input
          type="url"
          className={baseClass}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {fieldType === 'email' && (
        <input
          type="email"
          className={baseClass}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {fieldType === 'phone' && (
        <input
          type="tel"
          className={baseClass}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
