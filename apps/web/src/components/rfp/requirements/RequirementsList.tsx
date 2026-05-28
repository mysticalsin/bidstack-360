import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { LoadingSkeleton, EmptyState } from '@/components/ui/StateMessages';
import { useRfpRequirements } from '@/hooks/rfp/useRfpRequirements';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';
import { RequirementRow } from './RequirementRow';

export function RequirementsList() {
  const { t } = useTranslation('rfp');
  const bidWorkspaceId = useRfpPipelineStore((s) => s.bidWorkspaceId);
  const { data, isLoading, isError, error } = useRfpRequirements(bidWorkspaceId);

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('requirements.heading')}
          </h2>
          {data && (
            <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
              {t('requirements.count', { count: data.total })}
            </p>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="p-4">
          <LoadingSkeleton rows={4} />
        </div>
      )}

      {isError && (
        <div className="p-4">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error instanceof Error ? error.message : t('states.error')}
          </p>
        </div>
      )}

      {!isLoading && !isError && (!data || data.items.length === 0) && (
        <div className="p-6">
          <EmptyState
            title={t('requirements.emptyTitle')}
            message={t('requirements.emptyMessage')}
          />
        </div>
      )}

      {data && data.items.length > 0 && (
        <ul aria-label={t('requirements.listLabel')} role="list">
          {data.items.map((req) => (
            <RequirementRow key={req.id} requirement={req} />
          ))}
        </ul>
      )}
    </Card>
  );
}
