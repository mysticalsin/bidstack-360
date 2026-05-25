/**
 * Dynamic list page for a custom object — /o/:objectKey
 *
 * Renders like a standard CRM list page: table of records with record keys,
 * field values, pagination, and a "New" button to create records.
 *
 * The object definition is resolved from the org's def list by matching :objectKey.
 * If no match, we show a 404-style state.
 *
 * WCAG 2.2 AA. Dark mode. prefers-reduced-motion via CSS transitions only.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  useCreateCustomObjectRecord,
  useCustomObjectDefs,
  useCustomObjectRecords,
} from '@/hooks/useCustomObjects';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';

export function CustomObjectListPage() {
  const { objectKey = '' } = useParams<{ objectKey: string }>();
  const navigate = useNavigate();

  const { data: defsData, isLoading: defsLoading } = useCustomObjectDefs();
  const def = defsData?.items.find((d) => d.key === objectKey);

  const [page, setPage] = useState(1);
  const limit = 50;

  const recordsQuery = useCustomObjectRecords(def?.id ?? '', { page, limit });
  const createRecord = useCreateCustomObjectRecord(def?.id ?? '');

  const [showCreate, setShowCreate] = useState(false);
  const [createValues, setCreateValues] = useState<Record<string, string>>({ name: '' });
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!def) return;
    setCreateError(null);
    try {
      const record = await createRecord.mutateAsync({ values: createValues });
      setShowCreate(false);
      setCreateValues({ name: '' });
      navigate(`/o/${objectKey}/${record.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create record');
    }
  }

  if (defsLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-[var(--surface-2)] rounded" />
        <div className="h-64 bg-[var(--surface-2)] rounded-xl" />
      </div>
    );
  }

  if (!def) {
    return (
      <div className="p-6 text-center text-[var(--text-secondary)]">
        <p className="text-2xl mb-2">404</p>
        <p>Custom object &quot;{objectKey}&quot; not found.</p>
        <Link to="/settings/custom-objects" className="mt-4 inline-block text-[var(--accent)] underline">
          Manage custom objects
        </Link>
      </div>
    );
  }

  const records = recordsQuery.data?.items ?? [];
  const total = recordsQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  // Derive displayable field keys from first record (fallback to "name")
  const displayKeys =
    records.length > 0
      ? Object.keys(records[0]?.valuesJson ?? {}).slice(0, 4)
      : ['name'];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="w-6 h-6 rounded-md flex-shrink-0"
            style={{ backgroundColor: def.color }}
            aria-hidden="true"
          />
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{def.labelPlural}</h1>
          <span className="text-sm text-[var(--text-tertiary)]">
            {total > 0 ? `${total} total` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
            'bg-[var(--accent)] text-white hover:opacity-90 active:opacity-80',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            'transition-opacity min-h-[44px]',
          )}
        >
          <span aria-hidden="true">＋</span> New {def.labelSingular}
        </button>
      </div>

      {/* Table */}
      {recordsQuery.isLoading && (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 bg-[var(--surface-2)] rounded animate-pulse" />
          ))}
        </div>
      )}

      {recordsQuery.isError && (
        <div role="alert" className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">
          Failed to load records.
        </div>
      )}

      {!recordsQuery.isLoading && records.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-[var(--text-secondary)]">
          <p className="font-medium">No {def.labelPlural.toLowerCase()} yet</p>
          <p className="text-sm mt-1">Click &quot;New {def.labelSingular}&quot; to create your first record.</p>
        </div>
      )}

      {!recordsQuery.isLoading && records.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--surface-2)] text-[var(--text-secondary)] text-left">
                <th className="px-4 py-3 font-medium whitespace-nowrap">Record</th>
                {displayKeys.map((k) => (
                  <th key={k} className="px-4 py-3 font-medium capitalize whitespace-nowrap">
                    {k.replace(/_/g, ' ')}
                  </th>
                ))}
                <th className="px-4 py-3 font-medium whitespace-nowrap">Updated</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr
                  key={record.id}
                  className="border-t border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-[var(--text-tertiary)] whitespace-nowrap">
                    <Link
                      to={`/o/${objectKey}/${record.id}`}
                      className="text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded"
                    >
                      {record.recordKey}
                    </Link>
                  </td>
                  {displayKeys.map((k) => (
                    <td key={k} className="px-4 py-3 text-[var(--text-primary)] max-w-xs truncate">
                      {String(record.valuesJson[k] ?? '—')}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-[var(--text-tertiary)] whitespace-nowrap">
                    {relativeTime(record.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm disabled:opacity-40 hover:bg-[var(--surface-2)] transition-colors min-h-[44px]"
          >
            ← Previous
          </button>
          <span className="text-sm text-[var(--text-secondary)]">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm disabled:opacity-40 hover:bg-[var(--surface-2)] transition-colors min-h-[44px]"
          >
            Next →
          </button>
        </nav>
      )}

      {/* Create record modal */}
      {showCreate && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-record-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="bg-[var(--surface)] rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 id="create-record-title" className="text-lg font-semibold text-[var(--text-primary)]">
              New {def.labelSingular}
            </h2>
            <form onSubmit={(e) => { void handleCreate(e); }} className="space-y-3">
              {createError && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">{createError}</p>
              )}
              <div>
                <label htmlFor="cr-name" className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                  Name <span aria-hidden="true">*</span>
                </label>
                <input
                  id="cr-name"
                  type="text"
                  value={createValues.name ?? ''}
                  onChange={(e) => setCreateValues((v) => ({ ...v, name: e.target.value }))}
                  className="input w-full"
                  required
                  aria-required="true"
                  autoFocus
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setCreateValues({ name: '' }); setCreateError(null); }}
                  className="flex-1 px-4 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--surface-2)] transition-colors min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createRecord.isPending}
                  className="flex-1 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm hover:opacity-90 disabled:opacity-50 transition-opacity min-h-[44px]"
                >
                  {createRecord.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
