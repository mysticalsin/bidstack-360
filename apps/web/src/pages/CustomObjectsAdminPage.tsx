/**
 * Custom Objects admin page — /settings/custom-objects
 *
 * Lists all org custom object types with their record counts.
 * Admins can create a new object or navigate to the editor for an existing one.
 *
 * Design: Apple HIG card grid. Dark-mode via CSS vars. WCAG 2.2 AA.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { confirm } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
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
  const { t } = useTranslation('crm');
  const { data, isLoading, isError } = useCustomObjectDefs();
  const createDef = useCreateCustomObjectDef();
  const deleteDef = useDeleteCustomObjectDef();

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateFormState>(INITIAL_FORM);
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
      setFormError(
        t(
          'customObjectsAdmin.errorRequiredFields',
          'Key, singular label, and plural label are required.',
        ),
      );
      return;
    }
    if (!/^[a-z][a-z0-9_-]*$/.test(form.key)) {
      setFormError(
        t(
          'customObjectsAdmin.errorKeyFormat',
          'Key must start with a letter and contain only lowercase letters, digits, _ or -',
        ),
      );
      return;
    }
    try {
      await createDef.mutateAsync({
        key: form.key,
        labelSingular: form.labelSingular,
        labelPlural: form.labelPlural,
        description: form.description || undefined,
        icon: form.icon,
        color: form.color,
      });
      setShowCreate(false);
      setForm(INITIAL_FORM);
      toast.success(t('customObjectsAdmin.toastCreated', 'Custom object created'));
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : t('customObjectsAdmin.errorCreateFailed', 'Failed to create');
      setFormError(msg);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: t('customObjectsAdmin.deleteConfirmTitle', 'Delete Custom Object?'),
      description: t(
        'customObjectsAdmin.deleteConfirmDescription',
        'This will permanently delete the object definition and all records belonging to it. This action cannot be undone.',
      ),
      confirmLabel: t('customObjectsAdmin.deleteConfirmLabel', 'Delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteDef.mutateAsync(id);
    } catch (err) {
      toast.error(t('customObjectsAdmin.toastDeleteFailedTitle', 'Delete failed'), {
        description:
          err instanceof Error
            ? err.message
            : t('customObjectsAdmin.toastDeleteFailedTitle', 'Delete failed'),
      });
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--fg-primary)]">
            {t('customObjectsAdmin.title', 'Custom Objects')}
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            {t(
              'customObjectsAdmin.subtitle',
              'Define new entity types for your organisation — Projects, Vendors, Assets, and more.',
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
            'bg-[var(--brand-primary)] text-[var(--fg-on-brand)] hover:opacity-90 active:opacity-80',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            'transition-opacity min-h-[44px]',
          )}
        >
          <Icon name="plus" size={14} /> {t('customObjectsAdmin.newObjectButton', 'New Object')}
        </button>
      </div>

      {/* State: loading */}
      {isLoading && (
        <ul
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          aria-label={t('customObjectsAdmin.loadingLabel', 'Loading custom objects')}
        >
          {[1, 2, 3].map((i) => (
            <li key={i} className="bs-shimmer h-28 rounded-xl" />
          ))}
        </ul>
      )}

      {/* State: error */}
      {isError && (
        <div
          role="alert"
          className="p-4 rounded-lg bg-[var(--error-surface)] text-[var(--fg-error)]"
        >
          {t('customObjectsAdmin.errorLoad', 'Failed to load custom objects. Please refresh.')}
        </div>
      )}

      {/* State: empty */}
      {!isLoading && !isError && data?.items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-[var(--fg-secondary)]">
          <span
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--fg-tertiary)]"
            aria-hidden="true"
          >
            <Icon name="package" size={24} />
          </span>
          <p className="font-medium">
            {t('customObjectsAdmin.emptyTitle', 'No custom objects yet')}
          </p>
          <p className="text-sm mt-1">
            {t(
              'customObjectsAdmin.emptyDescription',
              'Click "New Object" to define your first custom entity type.',
            )}
          </p>
        </div>
      )}

      {/* State: list */}
      {!isLoading && !isError && data && data.items.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="custom-object-list">
          {data.items.map((def) => (
            <li key={def.id} className="group relative" data-testid={`custom-object-${def.key}`}>
              <Link
                to={`/settings/custom-objects/${def.id}`}
                className={cn(
                  'flex items-start gap-3 p-4 rounded-xl border border-[var(--border-subtle)]',
                  'bg-[var(--surface-card)] hover:bg-[var(--surface-hover)]',
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
                  <p className="font-semibold text-[var(--fg-primary)] truncate">
                    {def.labelSingular}
                  </p>
                  <p className="text-xs text-[var(--fg-secondary)] mt-0.5">{def.key}</p>
                  {def.description && (
                    <p className="text-sm text-[var(--fg-secondary)] mt-1 line-clamp-2">
                      {def.description}
                    </p>
                  )}
                </div>
                <span className="text-xs text-[var(--fg-tertiary)] ml-auto whitespace-nowrap">
                  {t('customObjectsAdmin.recordCount', '{{count}} records', {
                    count: def.recordCount ?? 0,
                  })}
                </span>
              </Link>

              {/* Delete button — appears on hover */}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  void handleDelete(def.id);
                }}
                className={cn(
                  'absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100',
                  'text-[var(--fg-tertiary)] hover:text-[var(--fg-error)] transition-opacity',
                  'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                  'min-w-[44px] min-h-[44px] flex items-center justify-center',
                )}
                aria-label={t('customObjectsAdmin.deleteItemLabel', 'Delete {{label}}', {
                  label: def.labelSingular,
                })}
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Create modal */}
      <Modal
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          setForm(INITIAL_FORM);
          setFormError(null);
        }}
        title={t('customObjectsAdmin.modalTitle', 'New Custom Object')}
      >
        <div className="bg-[var(--surface-card)] rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
            {t('customObjectsAdmin.modalTitle', 'New Custom Object')}
          </h2>
          <form
            onSubmit={(e) => {
              void handleCreate(e);
            }}
            className="space-y-3"
          >
            {formError && (
              <p role="alert" className="text-sm text-[var(--fg-error)]">
                {formError}
              </p>
            )}

            <div>
              <label
                htmlFor="co-label-singular"
                className="block text-sm font-medium text-[var(--fg-primary)] mb-1"
              >
                {t('customObjectsAdmin.fieldSingularLabel', 'Singular label')}{' '}
                <span aria-hidden="true">*</span>
              </label>
              <input
                id="co-label-singular"
                type="text"
                value={form.labelSingular}
                onChange={(e) => handleField('labelSingular', e.target.value)}
                placeholder={t('customObjectsAdmin.fieldSingularPlaceholder', 'e.g. Project')}
                required
                className="input w-full"
                aria-required="true"
              />
            </div>

            <div>
              <label
                htmlFor="co-label-plural"
                className="block text-sm font-medium text-[var(--fg-primary)] mb-1"
              >
                {t('customObjectsAdmin.fieldPluralLabel', 'Plural label')}{' '}
                <span aria-hidden="true">*</span>
              </label>
              <input
                id="co-label-plural"
                type="text"
                value={form.labelPlural}
                onChange={(e) => handleField('labelPlural', e.target.value)}
                placeholder={t('customObjectsAdmin.fieldPluralPlaceholder', 'e.g. Projects')}
                required
                className="input w-full"
                aria-required="true"
              />
            </div>

            <div>
              <label
                htmlFor="co-key"
                className="block text-sm font-medium text-[var(--fg-primary)] mb-1"
              >
                {t('customObjectsAdmin.fieldKeyLabel', 'API key')}{' '}
                <span className="text-[var(--fg-tertiary)] font-normal">
                  {t('customObjectsAdmin.fieldKeyAuto', '(auto)')}
                </span>
              </label>
              <input
                id="co-key"
                type="text"
                value={form.key}
                onChange={(e) => handleField('key', e.target.value)}
                placeholder={t('customObjectsAdmin.fieldKeyPlaceholder', 'e.g. project')}
                pattern="^[a-z][a-z0-9_-]*$"
                required
                className="input w-full font-mono text-sm"
                aria-required="true"
                aria-describedby="co-key-hint"
              />
              <p id="co-key-hint" className="text-xs text-[var(--fg-tertiary)] mt-0.5">
                {t(
                  'customObjectsAdmin.fieldKeyHint',
                  'Lowercase letters, digits, _ or - only. Immutable after creation.',
                )}
              </p>
            </div>

            <div>
              <label
                htmlFor="co-description"
                className="block text-sm font-medium text-[var(--fg-primary)] mb-1"
              >
                {t('customObjectsAdmin.fieldDescriptionLabel', 'Description')}
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
              <legend className="text-sm font-medium text-[var(--fg-primary)] mb-1">
                {t('customObjectsAdmin.fieldColorLegend', 'Color')}
              </legend>
              <div className="flex gap-2 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => handleField('color', c)}
                    className={cn(
                      'w-7 h-7 rounded-full border-2 transition-transform hover:scale-110',
                      // Gap ring matches the modal surface in both themes —
                      // border-white vanished against the light-mode modal.
                      form.color === c
                        ? 'border-[var(--surface-card)] ring-2 ring-[var(--ring)]'
                        : 'border-transparent',
                    )}
                    style={{ backgroundColor: c }}
                    aria-label={t('customObjectsAdmin.selectColorLabel', 'Select color {{color}}', {
                      color: c,
                    })}
                    aria-pressed={form.color === c}
                  />
                ))}
              </div>
            </fieldset>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  setForm(INITIAL_FORM);
                  setFormError(null);
                }}
                className="flex-1 px-4 py-2 rounded-lg border border-[var(--border-default)] text-sm font-medium text-[var(--fg-primary)] hover:bg-[var(--surface-hover)] transition-colors min-h-[44px]"
              >
                {t('customObjectsAdmin.cancelButton', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={createDef.isPending}
                className="flex-1 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--fg-on-brand)] text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity min-h-[44px]"
              >
                {createDef.isPending
                  ? t('customObjectsAdmin.creatingButton', 'Creating…')
                  : t('customObjectsAdmin.createButton', 'Create')}
              </button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}
