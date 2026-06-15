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
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  useCustomObjectDefs,
  useUpdateCustomObjectDef,
  useAddCustomObjectField,
  useCustomObjectFields,
  useCustomObjectRelations,
  useAddCustomObjectRelation,
} from '@/hooks/useCustomObjects';
import { ErrorState } from '@/components/ui/StateMessages';
import { ObjectSettingsForm } from './customObjectEditor/ObjectSettingsForm';
import { FieldsSection } from './customObjectEditor/FieldsSection';
import { RelationsSection } from './customObjectEditor/RelationsSection';

export function CustomObjectEditorPage() {
  const { t } = useTranslation('crm');
  const { id = '' } = useParams<{ id: string }>();
  const { data: defsData, isLoading, isError, error, refetch } = useCustomObjectDefs();
  const relationsQuery = useCustomObjectRelations(id);
  const updateDef = useUpdateCustomObjectDef(id);
  const addField = useAddCustomObjectField(id);
  const fieldsQuery = useCustomObjectFields(id);
  const addRelation = useAddCustomObjectRelation(id);

  const def = defsData?.items.find((d) => d.id === id);

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
          title={t('customObjectEditor.loadError.title', "Couldn't load object definitions")}
          message={
            error instanceof Error
              ? error.message
              : t('customObjectEditor.loadError.message', 'The server did not respond.')
          }
          action={
            <button type="button" className="btn btn-secondary" onClick={() => void refetch()}>
              {t('customObjectEditor.retry', 'Retry')}
            </button>
          }
        />
      </div>
    );
  }

  if (!def) {
    return (
      <div className="p-6 text-[var(--text-secondary)]">
        {t('customObjectEditor.notFound', 'Object not found.')}{' '}
        <Link to="/settings/custom-objects" className="underline text-[var(--accent)]">
          {t('customObjectEditor.backToList', 'Back to list')}
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      {/* Breadcrumb */}
      <nav aria-label={t('customObjectEditor.breadcrumbLabel', 'Breadcrumb')}>
        <ol className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <li>
            <Link to="/settings/custom-objects" className="hover:text-[var(--accent)] underline">
              {t('customObjectEditor.customObjects', 'Custom Objects')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-[var(--text-primary)] font-medium" aria-current="page">
            {def.labelSingular}
          </li>
        </ol>
      </nav>

      <ObjectSettingsForm def={def} updateDef={updateDef} />
      <FieldsSection addField={addField} fieldsQuery={fieldsQuery} />
      <RelationsSection addRelation={addRelation} relationsQuery={relationsQuery} />

      {/* Navigate to records */}
      <div>
        <Link
          to={`/o/${def.key}`}
          className="inline-flex items-center gap-2 text-sm text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded"
        >
          {t('customObjectEditor.viewRecords', 'View {{labelPlural}} →', {
            labelPlural: def.labelPlural,
          })}
        </Link>
      </div>
    </div>
  );
}
