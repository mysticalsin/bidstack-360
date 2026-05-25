/**
 * Custom Objects admin page — /settings/custom-objects
 *
 * Lists all org custom object types with their record counts.
 * Admins can create a new object or navigate to the editor for an existing one.
 *
 * Design: Apple HIG card grid. Dark-mode via CSS vars. WCAG 2.2 AA.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  useCreateCustomObjectDef,
  useCustomObjectDefs,
  useDeleteCustomObjectDef,
} from '@/hooks/useCustomObjects';
import { cn } from '@/lib/cn';

interface CreateFormState {
  key: string;
  labelSingular: string;
  labelPlural: string;
  description: string;
  icon: string;
  color: string;
}

const INITIAL_FORM: CreateFormState = {
  key: '',
  labelSingular: '',
  labelPlural: '',
  description: '',
  icon: 'box',
  color: '#6366f1',
};

const PRESET_COLORS = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
];

export function CustomObjectsAdminPage() {
  const { data, isLoading, isError } = useCustomObjectDefs();
  const createDef = useCreateCustomObjectDef();
  const deleteDef = useDeleteCustomObjectDef();
  const navigate = useNavigate();

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateFormState>(INITIAL_FORM);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function handleField(field: keyof CreateFormState, value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-generate key from labelSingular if key hasn't been manually edited
      if (field === 'labelSingular' && !prev.key) {
        next.key = value
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '');
      }
      // Auto-generate plural if it hasn't been manually edited
      if (field === 'labelSingular' && !prev.labelPlural) {
        next.labelPlural = `${value}s`;
      }
      return next;
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.key || !form.labelSingular || !form.labelPlural) {
      setFormError('Key, singular label, and plural label are required.');
      return;
    }
    if (!/^[a-z][a-z0-9_-]*$/.test(form.key)) {
      setFormError('Key must start with a letter and contain only lowercase letters, digits, _ or -');
      return;
    }
    try {
      const created = await createDef.mutateAsync({
        key: form.key,
        labelSingular: form.labelSingular,
        labelPlural: form.labelPlural,
        description: form.description || undefined,
        icon: form.icon,
        color: form.color,
      });
      setShowCreate(false);
      setForm(INITIAL_FORM);
      navigate(`/settings/custom-objects/${created.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create';
      setFormError(msg);
    }
  }

  async function handleDelete(id: string) {
    await deleteDef.mutateAsync(id);
    setDeleteTarget(null);
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Custom Objects</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Define new entity types for your organisation — Projects, Vendors, Assets, and more.
          </p>
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
          <span aria-hidden="true">＋</span> New Object
        </button>
      </div>

      {/* State: loading */}
      {isLoading && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4" aria-label="Loading custom objects">
          {[1, 2, 3].map((i) => (
            <li key={i} className="h-28 rounded-xl bg-[var(--surface-2)] animate-pulse" />
          ))}
        </ul>
      )}

      {/* State: error */}
      {isError && (
        <div role="alert" className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">
          Failed to load custom objects. Please refresh.
        </div>
      )}

      {/* State: empty */}
      {!isLoading && !isError && data?.items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-[var(--text-secondary)]">
          <span className="text-4xl mb-4" aria-hidden="true">📦</span>
          <p className="font-medium">No custom objects yet</p>
          <p className="text-sm mt-1">Click &quot;New Object&quot; to define your first custom entity type.</p>
        </div>
      )}

      {/* State: list */}
      {!isLoading && !isError && data && data.items.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {data.items.map((def) => (
            <li key={def.id} className="group relative">
              <Link
                to={`/settings/custom-objects/${def.id}`}
                className={cn(
                  'flex items-start gap-3 p-4 rounded-xl border border-[var(--border)]',
                  'bg-[var(--surface)] hover:bg-[var(--surface-2)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                  'transition-colors min-h-[44px]',
                )}
              >
                {/* Color dot */}
                <span
                  className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-md"
                  style={{ backgroundColor: def.color }}
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[var(--text-primary)] truncate">
                    {def.labelSingular}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">{def.key}</p>
                  {def.description && (
                    <p className="text-sm text-[var(--text-secondary)] mt-1 line-clamp-2">
                      {def.description}
                    </p>
                  )}
                </div>
                <span className="text-xs text-[var(--text-tertiary)] ml-auto whitespace-nowrap">
                  {def.recordCount ?? 0} records
                </span>
              </Link>

              {/* Delete button — appears on hover */}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setDeleteTarget(def.id);
                }}
                className={cn(
                  'absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100',
                  'text-[var(--text-tertiary)] hover:text-red-500 transition-opacity',
                  'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                  'min-w-[44px] min-h-[44px] flex items-center justify-center',
                )}
                aria-label={`Delete ${def.labelSingular}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Create modal */}
      {showCreate && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-obj-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="bg-[var(--surface)] rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 id="create-obj-title" className="text-lg font-semibold text-[var(--text-primary)]">
              New Custom Object
            </h2>
            <form onSubmit={(e) => { void handleCreate(e); }} className="space-y-3">
              {formError && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {formError}
                </p>
              )}

              <div>
                <label
                  htmlFor="co-label-singular"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-1"
                >
                  Singular label <span aria-hidden="true">*</span>
                </label>
                <input
                  id="co-label-singular"
                  type="text"
                  value={form.labelSingular}
                  onChange={(e) => handleField('labelSingular', e.target.value)}
                  placeholder="e.g. Project"
                  required
                  className="input w-full"
                  aria-required="true"
                />
              </div>

              <div>
                <label
                  htmlFor="co-label-plural"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-1"
                >
                  Plural label <span aria-hidden="true">*</span>
                </label>
                <input
                  id="co-label-plural"
                  type="text"
                  value={form.labelPlural}
                  onChange={(e) => handleField('labelPlural', e.target.value)}
                  placeholder="e.g. Projects"
                  required
                  className="input w-full"
                  aria-required="true"
                />
              </div>

              <div>
                <label
                  htmlFor="co-key"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-1"
                >
                  API key <span className="text-[var(--text-tertiary)] font-normal">(auto)</span>
                </label>
                <input
                  id="co-key"
                  type="text"
                  value={form.key}
                  onChange={(e) => handleField('key', e.target.value)}
                  placeholder="e.g. project"
                  pattern="^[a-z][a-z0-9_-]*$"
                  required
                  className="input w-full font-mono text-sm"
                  aria-required="true"
                  aria-describedby="co-key-hint"
                />
                <p id="co-key-hint" className="text-xs text-[var(--text-tertiary)] mt-0.5">
                  Lowercase letters, digits, _ or - only. Immutable after creation.
                </p>
              </div>

              <div>
                <label
                  htmlFor="co-description"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-1"
                >
                  Description
                </label>
                <textarea
                  id="co-description"
                  value={form.description}
                  onChange={(e) => handleField('description', e.target.value)}
                  rows={2}
                  className="input w-full resize-none"
                  maxLength={512}
                />
              </div>

              {/* Color picker */}
              <fieldset>
                <legend className="text-sm font-medium text-[var(--text-primary)] mb-1">
                  Color
                </legend>
                <div className="flex gap-2 flex-wrap">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => handleField('color', c)}
                      className={cn(
                        'w-7 h-7 rounded-full border-2 transition-transform hover:scale-110',
                        form.color === c
                          ? 'border-white ring-2 ring-[var(--ring)]'
                          : 'border-transparent',
                      )}
                      style={{ backgroundColor: c }}
                      aria-label={`Select color ${c}`}
                      aria-pressed={form.color === c}
                    />
                  ))}
                </div>
              </fieldset>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setForm(INITIAL_FORM); setFormError(null); }}
                  className="flex-1 px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createDef.isPending}
                  className="flex-1 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity min-h-[44px]"
                >
                  {createDef.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteTarget && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-obj-title"
          aria-describedby="delete-obj-desc"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="bg-[var(--surface)] rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 id="delete-obj-title" className="text-lg font-semibold text-[var(--text-primary)]">
              Delete Custom Object?
            </h2>
            <p id="delete-obj-desc" className="text-sm text-[var(--text-secondary)]">
              This will permanently delete the object definition and <strong>all records</strong>{' '}
              belonging to it. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void handleDelete(deleteTarget); }}
                disabled={deleteDef.isPending}
                className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {deleteDef.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
