import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { LoadingSkeleton, EmptyState } from '@/components/ui/StateMessages';
import { useRfpRequirements } from '@/hooks/rfp/useRfpRequirements';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';
import { extractedRequirementCaption, shownExtractedRequirements } from './requirement-caption';
import { RequirementRow } from './RequirementRow';
import { requirementsPhase } from './requirements-list-read';

export function RequirementsList() {
  const { t } = useTranslation('rfp');
  const bidWorkspaceId = useRfpPipelineStore((s) => s.bidWorkspaceId);
  const requirementsQuery = useRfpRequirements(bidWorkspaceId);
  const { data, error } = requirementsQuery;
  // A missing payload is not an empty extract. Empty is only a settled read.
  const phase = requirementsPhase(requirementsQuery);
  const page = shownExtractedRequirements(data?.items ?? [], data?.requirementsContinue);

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('requirements.heading')}
          </h2>
          {data && (
            <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
              {extractedRequirementCaption(page.items.length, page.pageContinues)}
            </p>
          )}
        </div>
      </div>

      {phase === 'unread' ? (
        <div className="p-4">
          <p role="status" className="mb-3 text-sm text-[var(--fg-secondary)]">
            {t('requirements.unread', 'Checking requirements. The list has not arrived.')}
          </p>
          <LoadingSkeleton rows={4} />
        </div>
      ) : null}

      {phase === 'failed' ? (
        <div className="p-4">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error instanceof Error ? error.message : t('states.error')}
          </p>
        </div>
      ) : null}

      {phase === 'ready' && data && page.items.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title={t('requirements.emptyTitle')}
            message={t('requirements.emptyMessage')}
          />
        </div>
      ) : null}

      {data && page.items.length > 0 && (
        <ul aria-label={t('requirements.listLabel')} role="list">
          {page.items.map((req) => (
            <RequirementRow key={req.id} requirement={req} />
          ))}
        </ul>
      )}
    </Card>
  );
}
