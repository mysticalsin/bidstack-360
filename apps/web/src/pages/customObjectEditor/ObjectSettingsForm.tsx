/**
 * ObjectSettingsForm — edits an object definition's labels, description, and colour.
 * Owns all form state; accepts the already-loaded `def` and the update mutation.
 */
import { useState, type FormEvent } from 'react';

import { type useUpdateCustomObjectDef } from '@/hooks/useCustomObjects';
import { cn } from '@/lib/cn';
import { PRESET_COLORS } from './customObjectEditorConfig';

interface ObjectDef {
  key: string;
  labelSingular: string;
  labelPlural: string;
  description?: string | null;
  color: string;
}

interface Props {
  def: ObjectDef;
  updateDef: ReturnType<typeof useUpdateCustomObjectDef>;
}

export function ObjectSettingsForm({ def, updateDef }: Props) {
  const [labelSingular, setLabelSingular] = useState('');
  const [labelPlural, setLabelPlural] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('');
  const [editInit, setEditInit] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState(false);

  // Initialise form once — same pattern as the original page.
  if (!editInit) {
    setLabelSingular(def.labelSingular);
    setLabelPlural(def.labelPlural);
    setDescription(def.description ?? '');
    setColor(def.color);
    setEditInit(true);
  }

  async function handleUpdate(e: FormEvent) {
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

  return (
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
  );
}
