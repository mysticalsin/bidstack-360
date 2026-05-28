/**
 * RelationsSection — lists existing relations and allows adding new ones.
 * Owns the add-relation form state.
 */
import { useState, type FormEvent } from 'react';

import {
  type useAddCustomObjectRelation,
  type useCustomObjectRelations,
} from '@/hooks/useCustomObjects';
import { CARDINALITIES } from './customObjectEditorConfig';

interface Props {
  addRelation: ReturnType<typeof useAddCustomObjectRelation>;
  relationsQuery: ReturnType<typeof useCustomObjectRelations>;
}

export function RelationsSection({ addRelation, relationsQuery }: Props) {
  const [showRelationForm, setShowRelationForm] = useState(false);
  const [newRelation, setNewRelation] = useState({
    relationKey: '',
    label: '',
    relatedEntityType: 'contact',
    cardinality: 'ONE_TO_MANY' as (typeof CARDINALITIES)[number],
    required: false,
  });
  const [relationError, setRelationError] = useState<string | null>(null);

  async function handleAddRelation(e: FormEvent) {
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

  return (
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
  );
}
