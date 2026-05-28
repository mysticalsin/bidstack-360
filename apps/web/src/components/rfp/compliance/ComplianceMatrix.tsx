// TODO: add @tanstack/react-virtual for 200+ row matrices
// (react-virtual is not yet installed in this package; using a scrollable table instead)
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { LoadingSkeleton, EmptyState } from '@/components/ui/StateMessages';
import { useRfpCompliance } from '@/hooks/rfp/useRfpCompliance';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';
import { ComplianceRow } from './ComplianceRow';

export function ComplianceMatrix() {
  const { t } = useTranslation('rfp');
  const bidWorkspaceId = useRfpPipelineStore((s) => s.bidWorkspaceId);
  const { data, isLoading, isError, error } = useRfpCompliance(bidWorkspaceId);

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('compliance.heading')}
          </h2>
          {data && (
            <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
              {t('compliance.summary', {
                compliant: data.compliantCount,
                total: data.total,
                pending: data.pendingCount,
              })}
            </p>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="p-4">
          <LoadingSkeleton rows={6} />
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
          <EmptyState title={t('compliance.emptyTitle')} message={t('compliance.emptyMessage')} />
        </div>
      )}

      {data && data.items.length > 0 && (
        // WHY: max-h with overflow-y-auto handles large lists without react-virtual
        <div
          className="max-h-[480px] overflow-y-auto"
          role="region"
          aria-label={t('compliance.matrixLabel')}
        >
          {/* Column headers */}
          <div
            aria-hidden="true"
            className="sticky top-0 flex items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-1.5"
          >
            <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
              {t('compliance.colRequirement')}
            </span>
            <span className="w-28 shrink-0 text-right text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
              {t('compliance.colStatus')}
            </span>
          </div>
          <div role="list" aria-label={t('compliance.matrixLabel')}>
            {data.items.map((row) => (
              <ComplianceRow key={row.id} row={row} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
