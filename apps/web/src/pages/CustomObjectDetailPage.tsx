/**
 * Dynamic detail page for a custom object record — /o/:objectKey/:recordId
 *
 * Displays all field values from the record's valuesJson, resolved against
 * the object's field definitions for labels and types.
 * Provides inline editing: click a field to edit, Save/Cancel per field.
 *
 * WCAG 2.2 AA. Dark mode. Keyboard navigable.
 */
import { type KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { confirm } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import { useHasPermission } from '@/hooks/useCapabilities';
import {
  useCustomObjectDefs,
  useCustomObjectFields,
  useCustomObjectRecord,
  useDeleteCustomObjectRecord,
  useUpdateCustomObjectRecord,
} from '@/hooks/useCustomObjects';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';

/**
 * Coerce the string-backed inline edit value into the JS type the API
 * validator (custom-field-validation.ts) expects for `fieldType`. Sending a
 * raw string for a number/boolean field 400s; text-like types stay strings.
 */
function coerceEditValue(fieldType: string | undefined, raw: string): unknown {
  const trimmed = raw.trim();
  switch (fieldType) {
    case 'number':
    case 'currency':
      // Empty clears the value; otherwise hand a real number to the API.
      return trimmed === '' ? null : Number(trimmed);
    case 'boolean':
      return raw === 'true';
    case 'date':
    case 'select':
      return trimmed === '' ? null : trimmed;
    default:
      // text / phone / email / url / unknown — stored as-is.
      return raw;
  }
}

export function CustomObjectDetailPage() {
  const { t } = useTranslation('crm');
  const { objectKey = '', recordId = '' } = useParams<{ objectKey: string; recordId: string }>();

  const { data: defsData } = useCustomObjectDefs();
  const def = defsData?.items.find((d) => d.key === objectKey);

  const recordQuery = useCustomObjectRecord(def?.id ?? '', recordId);
  const fieldsQuery = useCustomObjectFields(def?.id ?? '');
  const updateRecord = useUpdateCustomObjectRecord(def?.id ?? '', recordId);
  const deleteRecord = useDeleteCustomObjectRecord(def?.id ?? '');
  // Field edit (PUT) and delete (DELETE) on custom-object records are gated
  // server-side behind customObjects:write — disable the write affordances
  // for roles that lack it instead of letting them 403 on submit.
  const canWrite = useHasPermission('customObjects:write');
  const readOnlyHint = t(
    'customObjectDetail.readOnlyHint',
    'You need custom objects write access to edit this record.',
  );

  // Field metadata keyed by fieldKey — drives type-aware inputs + payload coercion.
  const fieldsByKey = new Map(fieldsQuery.data?.items.map((f) => [f.fieldKey, f]) ?? []);

  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [editError, setEditError] = useState<string | null>(null);

  const record = recordQuery.data;
  const values = (record?.valuesJson ?? {}) as Record<string, unknown>;

  function startEdit(fieldKey: string) {
    setEditField(fieldKey);
    const raw = String(values[fieldKey] ?? '');
    // A native date input needs YYYY-MM-DD; trim any stored ISO datetime tail.
    const isDate = fieldsByKey.get(fieldKey)?.fieldType === 'date';
    setEditValue(isDate ? raw.slice(0, 10) : raw);
    setEditError(null);
  }

  async function saveEdit() {
    if (!editField) return;
    setEditError(null);
    const fieldType = fieldsByKey.get(editField)?.fieldType;
    try {
      await updateRecord.mutateAsync({
        values: { [editField]: coerceEditValue(fieldType, editValue) },
      });
      setEditField(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : t('customObjectDetail.saveFailed', 'Save failed'));
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: t('customObjectDetail.deleteConfirmTitle', 'Delete {{label}}?', {
        label: def?.labelSingular ?? t('customObjectDetail.recordFallback', 'record'),
      }),
      description: t(
        'customObjectDetail.deleteConfirmDescription',
        '{{recordKey}} will be soft-deleted. It can be restored via the API.',
        { recordKey: record?.recordKey ?? t('customObjectDetail.thisRecordFallback', 'This record') },
      ),
      confirmLabel: t('customObjectDetail.deleteConfirmLabel', 'Delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteRecord.mutateAsync(recordId);
      window.history.back();
    } catch (err) {
      toast.error(t('customObjectDetail.deleteFailedTitle', 'Delete failed'), {
        description: err instanceof Error ? err.message : t('customObjectDetail.deleteFailedDescription', 'Delete failed'),
      });
    }
  }

  if (recordQuery.isLoading || !defsData) {
    return (
      // Shared bs-shimmer skeleton — surface-card blocks were invisible on the
      // white page background in light mode.
      <div className="p-6 max-w-3xl mx-auto space-y-4" role="status" aria-busy="true">
        <div className="bs-shimmer h-8 w-40" aria-hidden />
        <div className="bs-shimmer h-64 rounded-xl" aria-hidden />
      </div>
    );
  }

  if (!record || !def) {
    return (
      <div className="p-6 text-[var(--fg-secondary)]">
        {t('customObjectDetail.recordNotFound', 'Record not found.')}{' '}
        {def && (
          <Link to={`/o/${objectKey}`} className="underline text-[var(--brand-primary)]">
            {t('customObjectDetail.backToPlural', 'Back to {{plural}}', { plural: def.labelPlural })}
          </Link>
        )}
      </div>
    );
  }

  const fieldKeys = Object.keys(values);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <nav aria-label={t('customObjectDetail.breadcrumbAriaLabel', 'Breadcrumb')}>
        <ol className="flex items-center gap-2 text-sm text-[var(--fg-secondary)]">
          <li>
            <Link
              to={`/o/${objectKey}`}
              className="hover:text-[var(--brand-primary)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] rounded"
            >
              {def.labelPlural}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="font-mono text-xs text-[var(--fg-primary)]" aria-current="page">
            {record.recordKey}
          </li>
        </ol>
      </nav>

      {/* Record header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span
            className="w-8 h-8 rounded-md flex-shrink-0"
            style={{ backgroundColor: def.color }}
            aria-hidden="true"
          />
          <div>
            <h1 className="text-2xl font-semibold text-[var(--fg-primary)]">
              {String(values.name ?? record.recordKey)}
            </h1>
            <p className="text-sm text-[var(--fg-tertiary)] font-mono">{record.recordKey}</p>
          </div>
        </div>

        {/* Danger zone */}
        <button
          type="button"
          onClick={() => {
            void handleDelete();
          }}
          disabled={!canWrite}
          title={canWrite ? undefined : readOnlyHint}
          aria-label={
            canWrite
              ? undefined
              : `${t('customObjectDetail.deleteButton', 'Delete')} — ${readOnlyHint}`
          }
          className={cn(
            'px-3 py-1.5 rounded-lg border border-[var(--danger)]/40',
            'text-sm text-[var(--fg-error)] hover:bg-[var(--error-surface)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)]',
            'transition-colors min-h-[44px]',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
          )}
        >
          {t('customObjectDetail.deleteButton', 'Delete')}
        </button>
      </div>

      {/* Field values */}
      <section
        aria-labelledby="fields-section"
        className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-xl overflow-hidden"
      >
        <h2 id="fields-section" className="sr-only">
          {t('customObjectDetail.fieldValuesHeading', 'Field values')}
        </h2>
        <dl>
          {fieldKeys.map((key, i) => (
            <div
              key={key}
              className={cn(
                'grid grid-cols-3 items-start px-5 py-4',
                i > 0 && 'border-t border-[var(--border-subtle)]',
                // Sunken tint — surface-card on a surface-card section was invisible.
                editField === key && 'bg-[var(--surface-sunken)]',
              )}
            >
              <dt className="text-sm font-medium text-[var(--fg-secondary)] capitalize">
                {key.replace(/_/g, ' ')}
              </dt>
              <dd className="col-span-2">
                {editField === key ? (
                  <div className="flex items-center gap-2">
                    {(() => {
                      const fieldType = fieldsByKey.get(key)?.fieldType;
                      const sharedProps = {
                        value: editValue,
                        autoFocus: true,
                        className: 'input flex-1 text-sm',
                        // Enter saves, Escape cancels — same UX across every control type.
                        onKeyDown: (e: KeyboardEvent) => {
                          if (e.key === 'Enter') void saveEdit();
                          if (e.key === 'Escape') setEditField(null);
                        },
                        'aria-label': t('customObjectDetail.editFieldAriaLabel', 'Edit {{field}}', {
                          field: key.replace(/_/g, ' '),
                        }),
                      } as const;

                      if (fieldType === 'boolean') {
                        return (
                          <select {...sharedProps} onChange={(e) => setEditValue(e.target.value)}>
                            <option value="false">
                              {t('customObjectDetail.booleanFalse', 'No')}
                            </option>
                            <option value="true">
                              {t('customObjectDetail.booleanTrue', 'Yes')}
                            </option>
                          </select>
                        );
                      }
                      if (fieldType === 'select') {
                        const options = fieldsByKey.get(key)?.options ?? [];
                        return (
                          <select {...sharedProps} onChange={(e) => setEditValue(e.target.value)}>
                            <option value="">{t('customObjectDetail.selectNone', '—')}</option>
                            {options.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        );
                      }
                      const inputType =
                        fieldType === 'number' || fieldType === 'currency'
                          ? 'number'
                          : fieldType === 'date'
                            ? 'date'
                            : 'text';
                      return (
                        <input
                          {...sharedProps}
                          type={inputType}
                          onChange={(e) => setEditValue(e.target.value)}
                        />
                      );
                    })()}
                    <button
                      type="button"
                      onClick={() => {
                        void saveEdit();
                      }}
                      disabled={updateRecord.isPending}
                      className="px-3 py-1 rounded-lg bg-[var(--brand-primary)] text-[var(--fg-on-brand)] text-sm hover:opacity-90 disabled:opacity-50 transition-opacity min-h-[44px]"
                    >
                      {updateRecord.isPending
                        ? t('customObjectDetail.saving', '…')
                        : t('customObjectDetail.save', 'Save')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditField(null)}
                      className="px-3 py-1 rounded-lg border border-[var(--border-subtle)] text-sm hover:bg-[var(--surface-sunken)] transition-colors min-h-[44px]"
                    >
                      {t('customObjectDetail.cancel', 'Cancel')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => startEdit(key)}
                    disabled={!canWrite}
                    title={canWrite ? undefined : readOnlyHint}
                    className={cn(
                      'w-full text-left text-sm px-2 py-1 -ml-2 rounded',
                      'text-[var(--fg-primary)] hover:bg-[var(--surface-hover)]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]',
                      'transition-colors min-h-[44px] flex items-center',
                      'disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-transparent',
                    )}
                    aria-label={
                      canWrite
                        ? t('customObjectDetail.editFieldValueAriaLabel', 'Edit {{field}}: {{value}}', {
                            field: key.replace(/_/g, ' '),
                            value: String(values[key] ?? '—'),
                          })
                        : `${t('customObjectDetail.editFieldValueAriaLabel', 'Edit {{field}}: {{value}}', { field: key.replace(/_/g, ' '), value: String(values[key] ?? '—') })} — ${readOnlyHint}`
                    }
                  >
                    {String(values[key] ?? '—')}
                  </button>
                )}
                {editField === key && editError && (
                  <p role="alert" className="text-xs text-[var(--fg-error)] mt-1">
                    {editError}
                  </p>
                )}
              </dd>
            </div>
          ))}

          {fieldKeys.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-[var(--fg-secondary)]">
              {t('customObjectDetail.emptyFields', 'No fields defined yet. Add fields in the')}{' '}
              <Link
                to={`/settings/custom-objects/${def.id}`}
                className="underline text-[var(--brand-primary)]"
              >
                {t('customObjectDetail.objectEditorLink', 'object editor')}
              </Link>
              {t('customObjectDetail.emptyFieldsPeriod', '.')}
            </div>
          )}
        </dl>
      </section>

      {/* Metadata */}
      <section className="text-xs text-[var(--fg-tertiary)] space-y-1">
        <p>{t('customObjectDetail.createdAt', 'Created {{time}}', { time: relativeTime(record.createdAt) })}</p>
        <p>{t('customObjectDetail.updatedAt', 'Updated {{time}}', { time: relativeTime(record.updatedAt) })}</p>
        {record.deletedAt && (
          <p className="text-[var(--danger)]">
            {t('customObjectDetail.deletedAt', 'Deleted {{time}}', { time: relativeTime(record.deletedAt) })}
          </p>
        )}
      </section>
    </div>
  );
}
