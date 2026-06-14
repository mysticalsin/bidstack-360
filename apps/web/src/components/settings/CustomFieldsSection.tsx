import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, SectionHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/StateMessages';
import {
  useCustomFieldDefinitions,
  useCreateCustomFieldDefinition,
  usePatchCustomFieldDefinition,
  useDeleteCustomFieldDefinition,
} from '@/hooks/useCustomFields';
import type { EntityType, FieldType } from '@bidstack/shared';

const ENTITY_TYPES: { value: EntityType; label: string }[] = [
  { value: 'company', label: 'Companies' },
  { value: 'contact', label: 'Contacts' },
  { value: 'opportunity', label: 'Opportunities' },
  { value: 'lead', label: 'Leads' },
  { value: 'task', label: 'Tasks' },
];

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'select', label: 'Select' },
  { value: 'multi_select', label: 'Multi-select' },
  { value: 'currency', label: 'Currency' },
  { value: 'url', label: 'URL' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
];

export function CustomFieldsSection() {
  const { t } = useTranslation('settings');
  const [entityType, setEntityType] = useState<EntityType>('company');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const defs = useCustomFieldDefinitions(entityType);
  const create = useCreateCustomFieldDefinition();
  const patch = usePatchCustomFieldDefinition(editingId ?? undefined);
  const remove = useDeleteCustomFieldDefinition();

  const activeItems = defs.data?.items.filter((d) => d.active) ?? [];

  return (
    <Card>
      <SectionHeader
        title={t('customFields.heading', 'Custom Fields')}
        caption={t('customFields.caption', 'Define extra fields for each entity type.')}
      />
      <div className="p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="input text-sm"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as EntityType)}
          >
            {ENTITY_TYPES.map((et) => (
              <option key={et.value} value={et.value}>
                {t(`customFields.entityType.${et.value}`, et.label)}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            onClick={() => {
              setEditingId(null);
              setShowForm(true);
            }}
          >
            {t('customFields.addField', '+ Add field')}
          </Button>
        </div>

        {showForm && (
          <FieldForm
            key={editingId ?? 'new'}
            initial={editingId ? defs.data?.items.find((d) => d.id === editingId) : undefined}
            onSave={async (body) => {
              if (editingId) {
                await patch.mutateAsync({ body: { ...body, entityType }, entityType });
              } else {
                await create.mutateAsync({ ...body, entityType, active: true, orderIndex: 0 });
              }
              setShowForm(false);
              setEditingId(null);
            }}
            onCancel={() => {
              setShowForm(false);
              setEditingId(null);
            }}
            isPending={create.isPending || patch.isPending}
          />
        )}

        {activeItems.length === 0 ? (
          <EmptyState
            title={t('customFields.empty.title', 'No custom fields')}
            message={t('customFields.empty.message', 'Add fields to capture extra data.')}
          />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {activeItems.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--fg-primary)]">{d.label}</span>
                    <Badge tone="gray">{d.fieldType}</Badge>
                    {d.required && <Badge tone="tomato">{t('customFields.required', 'Required')}</Badge>}
                  </div>
                  <div className="text-xs text-[var(--fg-tertiary)]">
                    {t('customFields.meta', 'Key: {{fieldKey}} · Order: {{orderIndex}}', {
                      fieldKey: d.fieldKey,
                      orderIndex: d.orderIndex,
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingId(d.id);
                      setShowForm(true);
                    }}
                  >
                    {t('customFields.edit', 'Edit')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (
                        confirm(
                          t('customFields.deleteConfirm', 'Delete field "{{label}}"?', {
                            label: d.label,
                          }),
                        )
                      )
                        remove.mutate({ id: d.id, entityType });
                    }}
                  >
                    {t('customFields.delete', 'Delete')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function FieldForm({
  initial,
  onSave,
  onCancel,
  isPending,
}: {
  initial?: {
    label: string;
    fieldKey: string;
    fieldType: FieldType;
    options: string[];
    required: boolean;
  };
  onSave: (body: {
    label: string;
    fieldKey: string;
    fieldType: FieldType;
    options: string[];
    required: boolean;
  }) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation('settings');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [fieldKey, setFieldKey] = useState(initial?.fieldKey ?? '');
  const [fieldType, setFieldType] = useState<FieldType>(initial?.fieldType ?? 'text');
  const [options, setOptions] = useState(initial?.options?.join('\n') ?? '');
  const [required, setRequired] = useState(initial?.required ?? false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      label,
      fieldKey,
      fieldType,
      options: options
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      required,
    });
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] p-4 space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
            {t('customFields.form.label', 'Label')}
          </label>
          <input
            className="input w-full text-sm"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('customFields.form.labelPlaceholder', 'Field label')}
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
            {t('customFields.form.key', 'Key')}
          </label>
          <input
            className="input w-full text-sm"
            value={fieldKey}
            onChange={(e) => setFieldKey(e.target.value)}
            placeholder="field_key"
            required
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
            {t('customFields.form.type', 'Type')}
          </label>
          <select
            className="input w-full text-sm"
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as FieldType)}
          >
            {FIELD_TYPES.map((ft) => (
              <option key={ft.value} value={ft.value}>
                {t(`customFields.fieldType.${ft.value}`, ft.label)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 pt-5">
          <input
            id="req"
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          <label htmlFor="req" className="text-sm text-[var(--fg-secondary)]">
            {t('customFields.form.required', 'Required')}
          </label>
        </div>
      </div>
      {(fieldType === 'select' || fieldType === 'multi_select') && (
        <div>
          <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
            {t('customFields.form.options', 'Options (one per line)')}
          </label>
          <textarea
            className="input w-full text-sm min-h-[60px]"
            value={options}
            onChange={(e) => setOptions(e.target.value)}
          />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
          {t('customFields.form.cancel', 'Cancel')}
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={isPending}>
          {isPending ? t('customFields.form.saving', 'Saving…') : t('customFields.form.save', 'Save')}
        </button>
      </div>
    </form>
  );
}
