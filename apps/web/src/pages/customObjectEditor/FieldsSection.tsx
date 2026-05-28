/**
 * FieldsSection — lists system fields and allows adding new custom fields.
 * Owns the add-field form state.
 */
import { useState, type FormEvent } from 'react';

import { type useAddCustomObjectField } from '@/hooks/useCustomObjects';
import { FIELD_TYPES } from './customObjectEditorConfig';

interface Props {
  addField: ReturnType<typeof useAddCustomObjectField>;
}

export function FieldsSection({ addField }: Props) {
  const [showFieldForm, setShowFieldForm] = useState(false);
  const [newField, setNewField] = useState({
    fieldKey: '',
    label: '',
    fieldType: 'text' as (typeof FIELD_TYPES)[number],
    required: false,
    orderIndex: 0,
  });
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function handleAddField(e: FormEvent) {
    e.preventDefault();
    setFieldError(null);
    if (!newField.fieldKey || !newField.label) {
      setFieldError('Field key and label are required.');
      return;
    }
    try {
      await addField.mutateAsync(newField);
      setShowFieldForm(false);
      setNewField({ fieldKey: '', label: '', fieldType: 'text', required: false, orderIndex: 0 });
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : 'Failed to add field');
    }
  }

  return (
    <section aria-labelledby="fields-heading">
      <div className="flex items-center justify-between mb-4">
        <h2 id="fields-heading" className="text-lg font-semibold text-[var(--text-primary)]">
          Fields
        </h2>
        <button
          type="button"
          onClick={() => setShowFieldForm(true)}
          className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--surface-2)] transition-colors min-h-[44px]"
        >
          + Add field
        </button>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
        {/* System fields notice */}
        <div className="px-4 py-3 bg-[var(--surface-2)] text-xs text-[var(--text-tertiary)] border-b border-[var(--border)]">
          System fields: <code className="font-mono">name</code>,{' '}
          <code className="font-mono">owner</code>, <code className="font-mono">created_date</code>
        </div>

        {showFieldForm && (
          <form
            onSubmit={(e) => {
              void handleAddField(e);
            }}
            className="p-4 border-b border-[var(--border)] space-y-3 bg-[var(--surface-3)]"
          >
            {fieldError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {fieldError}
              </p>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="nf-key"
                  className="block text-xs font-medium text-[var(--text-primary)] mb-1"
                >
                  Field key
                </label>
                <input
                  id="nf-key"
                  type="text"
                  value={newField.fieldKey}
                  onChange={(e) =>
                    setNewField((p) => ({
                      ...p,
                      fieldKey: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                    }))
                  }
                  placeholder="e.g. budget"
                  className="input w-full text-sm"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="nf-label"
                  className="block text-xs font-medium text-[var(--text-primary)] mb-1"
                >
                  Label
                </label>
                <input
                  id="nf-label"
                  type="text"
                  value={newField.label}
                  onChange={(e) => setNewField((p) => ({ ...p, label: e.target.value }))}
                  placeholder="e.g. Budget"
                  className="input w-full text-sm"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="nf-type"
                  className="block text-xs font-medium text-[var(--text-primary)] mb-1"
                >
                  Type
                </label>
                <select
                  id="nf-type"
                  value={newField.fieldType}
                  onChange={(e) =>
                    setNewField((p) => ({
                      ...p,
                      fieldType: e.target.value as (typeof FIELD_TYPES)[number],
                    }))
                  }
                  className="input w-full text-sm"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={newField.required}
                  onChange={(e) => setNewField((p) => ({ ...p, required: e.target.checked }))}
                  className="accent-[var(--accent)]"
                />
                Required
              </label>
              <div className="flex gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setShowFieldForm(false)}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--surface-2)] transition-colors min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addField.isPending}
                  className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-sm hover:opacity-90 disabled:opacity-50 transition-opacity min-h-[44px]"
                >
                  {addField.isPending ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
          </form>
        )}

        <p className="p-4 text-sm text-[var(--text-secondary)]">
          Fields are managed via the Custom Fields API. Use the &quot;Add field&quot; button above
          to add new fields to this object.
        </p>
      </div>
    </section>
  );
}
