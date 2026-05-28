/**
 * Dynamic detail page for a custom object record — /o/:objectKey/:recordId
 *
 * Displays all field values from the record's valuesJson, resolved against
 * the object's field definitions for labels and types.
 * Provides inline editing: click a field to edit, Save/Cancel per field.
 *
 * WCAG 2.2 AA. Dark mode. Keyboard navigable.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { confirm } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import {
  useCustomObjectDefs,
  useCustomObjectRecord,
  useDeleteCustomObjectRecord,
  useUpdateCustomObjectRecord,
} from '@/hooks/useCustomObjects';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';

export function CustomObjectDetailPage() {
  const { objectKey = '', recordId = '' } = useParams<{ objectKey: string; recordId: string }>();

  const { data: defsData } = useCustomObjectDefs();
  const def = defsData?.items.find((d) => d.key === objectKey);

  const recordQuery = useCustomObjectRecord(def?.id ?? '', recordId);
  const updateRecord = useUpdateCustomObjectRecord(def?.id ?? '', recordId);
  const deleteRecord = useDeleteCustomObjectRecord(def?.id ?? '');

  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [editError, setEditError] = useState<string | null>(null);

  const record = recordQuery.data;
  const values = (record?.valuesJson ?? {}) as Record<string, unknown>;

  function startEdit(fieldKey: string) {
    setEditField(fieldKey);
    setEditValue(String(values[fieldKey] ?? ''));
    setEditError(null);
  }

  async function saveEdit() {
    if (!editField) return;
    setEditError(null);
    try {
      await updateRecord.mutateAsync({ values: { [editField]: editValue } });
      setEditField(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete ${def?.labelSingular ?? 'record'}?`,
      description: `${record?.recordKey ?? 'This record'} will be soft-deleted. It can be restored via the API.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteRecord.mutateAsync(recordId);
      window.history.back();
    } catch (err) {
      toast.error('Delete failed', {
        description: err instanceof Error ? err.message : 'Delete failed',
      });
    }
  }

  if (recordQuery.isLoading || !defsData) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4 animate-pulse">
        <div className="h-8 w-40 bg-[var(--surface-2)] rounded" />
        <div className="h-64 bg-[var(--surface-2)] rounded-xl" />
      </div>
    );
  }

  if (!record || !def) {
    return (
      <div className="p-6 text-[var(--text-secondary)]">
        Record not found.{' '}
        {def && (
          <Link to={`/o/${objectKey}`} className="underline text-[var(--accent)]">
            Back to {def.labelPlural}
          </Link>
        )}
      </div>
    );
  }

  const fieldKeys = Object.keys(values);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <li>
            <Link
              to={`/o/${objectKey}`}
              className="hover:text-[var(--accent)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded"
            >
              {def.labelPlural}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="font-mono text-xs text-[var(--text-primary)]" aria-current="page">
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
            <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
              {String(values.name ?? record.recordKey)}
            </h1>
            <p className="text-sm text-[var(--text-tertiary)] font-mono">{record.recordKey}</p>
          </div>
        </div>

        {/* Danger zone */}
        <button
          type="button"
          onClick={() => {
            void handleDelete();
          }}
          className={cn(
            'px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800',
            'text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400',
            'transition-colors min-h-[44px]',
          )}
        >
          Delete
        </button>
      </div>

      {/* Field values */}
      <section
        aria-labelledby="fields-section"
        className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden"
      >
        <h2 id="fields-section" className="sr-only">
          Field values
        </h2>
        <dl>
          {fieldKeys.map((key, i) => (
            <div
              key={key}
              className={cn(
                'grid grid-cols-3 items-start px-5 py-4',
                i > 0 && 'border-t border-[var(--border)]',
                editField === key && 'bg-[var(--surface-2)]',
              )}
            >
              <dt className="text-sm font-medium text-[var(--text-secondary)] capitalize">
                {key.replace(/_/g, ' ')}
              </dt>
              <dd className="col-span-2">
                {editField === key ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="input flex-1 text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveEdit();
                        if (e.key === 'Escape') setEditField(null);
                      }}
                      aria-label={`Edit ${key.replace(/_/g, ' ')}`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void saveEdit();
                      }}
                      disabled={updateRecord.isPending}
                      className="px-3 py-1 rounded-lg bg-[var(--accent)] text-white text-sm hover:opacity-90 disabled:opacity-50 transition-opacity min-h-[44px]"
                    >
                      {updateRecord.isPending ? '…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditField(null)}
                      className="px-3 py-1 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--surface-3)] transition-colors min-h-[44px]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => startEdit(key)}
                    className={cn(
                      'w-full text-left text-sm px-2 py-1 -ml-2 rounded',
                      'text-[var(--text-primary)] hover:bg-[var(--surface-2)]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                      'transition-colors min-h-[44px] flex items-center',
                    )}
                    aria-label={`Edit ${key.replace(/_/g, ' ')}: ${String(values[key] ?? '—')}`}
                  >
                    {String(values[key] ?? '—')}
                  </button>
                )}
                {editField === key && editError && (
                  <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">
                    {editError}
                  </p>
                )}
              </dd>
            </div>
          ))}

          {fieldKeys.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-[var(--text-secondary)]">
              No fields defined yet. Add fields in the{' '}
              <Link
                to={`/settings/custom-objects/${def.id}`}
                className="underline text-[var(--accent)]"
              >
                object editor
              </Link>
              .
            </div>
          )}
        </dl>
      </section>

      {/* Metadata */}
      <section className="text-xs text-[var(--text-tertiary)] space-y-1">
        <p>Created {relativeTime(record.createdAt)}</p>
        <p>Updated {relativeTime(record.updatedAt)}</p>
        {record.deletedAt && (
          <p className="text-red-500">Deleted {relativeTime(record.deletedAt)}</p>
        )}
      </section>
    </div>
  );
}
