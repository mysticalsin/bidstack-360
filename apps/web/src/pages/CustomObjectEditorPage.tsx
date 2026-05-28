/**
 * Custom Object editor — /settings/custom-objects/:id
 *
 * Lets admins:
 * - Edit the object def (label, icon, color, description)
 * - View and add custom fields (reuses the same patterns as W5-8)
 * - View and add relations
 *
 * WCAG 2.2 AA. Dark mode. prefers-reduced-motion respected via CSS.
 */
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';

import {
  useCustomObjectDefs,
  useUpdateCustomObjectDef,
  useAddCustomObjectField,
  useCustomObjectRelations,
  useAddCustomObjectRelation,
} from '@/hooks/useCustomObjects';
import { cn } from '@/lib/cn';
import { ErrorState } from '@/components/ui/StateMessages';

const FIELD_TYPES = [
  'text',
  'number',
  'date',
  'boolean',
  'select',
  'multi_select',
  'currency',
  'url',
  'email',
  'phone',
] as const;

const CARDINALITIES = ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_MANY'] as const;

const PRESET_COLORS = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
];

export function CustomObjectEditorPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data: defsData, isLoading, isError, error, refetch } = useCustomObjectDefs();
  const relationsQuery = useCustomObjectRelations(id);
  const updateDef = useUpdateCustomObjectDef(id);
  const addField = useAddCustomObjectField(id);
  const addRelation = useAddCustomObjectRelation(id);

  const def = defsData?.items.find((d) => d.id === id);

  const [labelSingular, setLabelSingular] = useState('');
  const [labelPlural, setLabelPlural] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('');
  const [editInit, setEditInit] = useState(false);

  // Initialise form once def loads
  if (def && !editInit) {
    setLabelSingular(def.labelSingular);
    setLabelPlural(def.labelPlural);
    setDescription(def.description ?? '');
    setColor(def.color);
    setEditInit(true);
  }

  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState(false);

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    setUpdateError(null);
    setUpdateSuccess(false);
    try {
      await updateDef.mutateAsync({
        labelSingular,
        labelPlural,
        description: description || undefined,
        color,
      });
      setUpdateSuccess(true);
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  // Field creation state
  const [showFieldForm, setShowFieldForm] = useState(false);
  const [newField, setNewField] = useState({
    fieldKey: '',
    label: '',
    fieldType: 'text' as (typeof FIELD_TYPES)[number],
    required: false,
    orderIndex: 0,
  });
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function handleAddField(e: React.FormEvent) {
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

  // Relation creation state
  const [showRelationForm, setShowRelationForm] = useState(false);
  const [newRelation, setNewRelation] = useState({
    relationKey: '',
    label: '',
    relatedEntityType: 'contact',
    cardinality: 'ONE_TO_MANY' as (typeof CARDINALITIES)[number],
    required: false,
  });
  const [relationError, setRelationError] = useState<string | null>(null);

  async function handleAddRelation(e: React.FormEvent) {
    e.preventDefault();
    setRelationError(null);
    if (!newRelation.relationKey || !newRelation.label) {
      setRelationError('Relation key and label are required.');
      return;
    }
    try {
      await addRelation.mutateAsync(newRelation);
      setShowRelationForm(false);
      setNewRelation({
        relationKey: '',
        label: '',
        relatedEntityType: 'contact',
        cardinality: 'ONE_TO_MANY',
        required: false,
      });
    } catch (err) {
      setRelationError(err instanceof Error ? err.message : 'Failed to add relation');
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-3xl mx-auto animate-pulse">
        <div className="h-8 w-48 bg-[var(--surface-2)] rounded" />
        <div className="h-40 bg-[var(--surface-2)] rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <ErrorState
          title="Couldn't load object definitions"
          message={error instanceof Error ? error.message : 'The server did not respond.'}
          action={
            <button type="button" className="btn btn-secondary" onClick={() => void refetch()}>
              Retry
            </button>
          }
        />
      </div>
    );
  }

  if (!def) {
    return (
      <div className="p-6 text-[var(--text-secondary)]">
        Object not found.{' '}
        <Link to="/settings/custom-objects" className="underline text-[var(--accent)]">
          Back to list
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <li>
            <Link to="/settings/custom-objects" className="hover:text-[var(--accent)] underline">
              Custom Objects
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-[var(--text-primary)] font-medium" aria-current="page">
            {def.labelSingular}
          </li>
        </ol>
      </nav>

      {/* Object metadata editor */}
      <section aria-labelledby="edit-def-heading">
        <h2 id="edit-def-heading" className="text-lg font-semibold text-[var(--text-primary)] mb-4">
          Object Settings
        </h2>
        <form
          onSubmit={(e) => {
            void handleUpdate(e);
          }}
          className="space-y-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5"
        >
          {updateError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {updateError}
            </p>
          )}
          {updateSuccess && (
            <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
              Saved.
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="ed-singular"
                className="block text-sm font-medium text-[var(--text-primary)] mb-1"
              >
                Singular label
              </label>
              <input
                id="ed-singular"
                type="text"
                value={labelSingular}
                onChange={(e) => setLabelSingular(e.target.value)}
                className="input w-full"
                required
              />
            </div>
            <div>
              <label
                htmlFor="ed-plural"
                className="block text-sm font-medium text-[var(--text-primary)] mb-1"
              >
                Plural label
              </label>
              <input
                id="ed-plural"
                type="text"
                value={labelPlural}
                onChange={(e) => setLabelPlural(e.target.value)}
                className="input w-full"
                required
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="ed-description"
              className="block text-sm font-medium text-[var(--text-primary)] mb-1"
            >
              Description
            </label>
            <textarea
              id="ed-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="input w-full resize-none"
              maxLength={512}
            />
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-[var(--text-primary)] mb-1">Color</legend>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    'w-7 h-7 rounded-full border-2 transition-transform hover:scale-110',
                    color === c ? 'border-white ring-2 ring-[var(--ring)]' : 'border-transparent',
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={`Select color ${c}`}
                  aria-pressed={color === c}
                />
              ))}
            </div>
          </fieldset>

          <div className="flex justify-between items-center pt-1">
            <p className="text-xs text-[var(--text-tertiary)]">
              API key: <code className="font-mono">{def.key}</code> (immutable)
            </p>
            <button
              type="submit"
              disabled={updateDef.isPending}
              className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity min-h-[44px]"
            >
              {updateDef.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </section>

      {/* Fields */}
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
            <code className="font-mono">owner</code>,{' '}
            <code className="font-mono">created_date</code>
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

      {/* Relations */}
      <section aria-labelledby="relations-heading">
        <div className="flex items-center justify-between mb-4">
          <h2 id="relations-heading" className="text-lg font-semibold text-[var(--text-primary)]">
            Relations
          </h2>
          <button
            type="button"
            onClick={() => setShowRelationForm(true)}
            className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--surface-2)] transition-colors min-h-[44px]"
          >
            + Add relation
          </button>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          {showRelationForm && (
            <form
              onSubmit={(e) => {
                void handleAddRelation(e);
              }}
              className="p-4 border-b border-[var(--border)] space-y-3 bg-[var(--surface-3)]"
            >
              {relationError && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {relationError}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="nr-key"
                    className="block text-xs font-medium text-[var(--text-primary)] mb-1"
                  >
                    Relation key
                  </label>
                  <input
                    id="nr-key"
                    type="text"
                    value={newRelation.relationKey}
                    onChange={(e) =>
                      setNewRelation((p) => ({
                        ...p,
                        relationKey: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '_'),
                      }))
                    }
                    placeholder="e.g. primary_contact"
                    className="input w-full text-sm"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="nr-label"
                    className="block text-xs font-medium text-[var(--text-primary)] mb-1"
                  >
                    Label
                  </label>
                  <input
                    id="nr-label"
                    type="text"
                    value={newRelation.label}
                    onChange={(e) => setNewRelation((p) => ({ ...p, label: e.target.value }))}
                    placeholder="e.g. Primary Contact"
                    className="input w-full text-sm"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="nr-entity"
                    className="block text-xs font-medium text-[var(--text-primary)] mb-1"
                  >
                    Related entity
                  </label>
                  <input
                    id="nr-entity"
                    type="text"
                    value={newRelation.relatedEntityType}
                    onChange={(e) =>
                      setNewRelation((p) => ({ ...p, relatedEntityType: e.target.value }))
                    }
                    placeholder="e.g. contact, opportunity"
                    className="input w-full text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="nr-cardinality"
                    className="block text-xs font-medium text-[var(--text-primary)] mb-1"
                  >
                    Cardinality
                  </label>
                  <select
                    id="nr-cardinality"
                    value={newRelation.cardinality}
                    onChange={(e) =>
                      setNewRelation((p) => ({
                        ...p,
                        cardinality: e.target.value as (typeof CARDINALITIES)[number],
                      }))
                    }
                    className="input w-full text-sm"
                  >
                    {CARDINALITIES.map((c) => (
                      <option key={c} value={c}>
                        {c.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowRelationForm(false)}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--surface-2)] transition-colors min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addRelation.isPending}
                  className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-sm hover:opacity-90 disabled:opacity-50 transition-opacity min-h-[44px]"
                >
                  {addRelation.isPending ? 'Adding…' : 'Add'}
                </button>
              </div>
            </form>
          )}

          {relationsQuery.data?.items.length === 0 && (
            <p className="p-4 text-sm text-[var(--text-secondary)]">No relations defined yet.</p>
          )}

          {relationsQuery.data?.items.map((rel) => (
            <div
              key={rel.id}
              className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] last:border-0"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">{rel.label}</p>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {rel.relationKey} → {rel.relatedEntityType}
                  {' · '}
                  {rel.cardinality.replace(/_/g, ' ').toLowerCase()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Navigate to records */}
      <div>
        <Link
          to={`/o/${def.key}`}
          className="inline-flex items-center gap-2 text-sm text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded"
        >
          View {def.labelPlural} →
        </Link>
      </div>
    </div>
  );
}
