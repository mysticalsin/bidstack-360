// Open pipeline per sector (back row) with its overdue part in front, summed
// over every opportunity page so older open bids still count.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sectorPipeline } from '@/components/charts/bid-chart-data';
import { IsoBars } from '@/components/charts/tuffui/iso-bars';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/StateMessages';
import { fmtCompact } from '@/components/viz/viz-data';
import { useAllOpportunityRows } from '@/hooks/useOpportunityRows';

export function SectorPipelineCard() {
  const { t } = useTranslation('crm');
  const rows = useAllOpportunityRows();
  const [now] = useState(() => Date.now());
  const data = sectorPipeline(rows.data?.items ?? [], now);

  return (
    <Card className="p-4" data-testid="sector-pipeline-iso">
      <h2 className="mb-3 text-base font-semibold text-fg-primary">
        {t('sectorView.pipelineIsoTitle', 'Pipeline by sector')}
      </h2>
      {rows.isLoading ? (
        <p className="py-6 text-center text-sm text-fg-secondary">{t('sectorView.pipelineIsoLoading', 'Loading pipeline.')}</p>
      ) : rows.isError ? (
        <ErrorState
          title={t('sectorView.pipelineIsoError', 'Could not load pipeline')}
          action={
            <Button variant="secondary" size="sm" onClick={() => void rows.refetch()}>
              {t('sectorView.pipelineIsoRetry', 'Retry')}
            </Button>
          }
        />
      ) : (
        <>
          {rows.data && !rows.data.complete ? (
            <p className="mb-2 text-xs text-fg-tertiary">
              {t('sectorView.pipelineIsoPartial', 'Totals cover the first {{count}} opportunities. Later pages are not included.', {
                count: rows.data.items.length,
              })}
            </p>
          ) : null}
          <IsoBars
            title={t('sectorView.pipelineIsoTitle', 'Pipeline by sector')}
            labels={data.labels}
            back={[{ id: 'open', label: t('sectorView.pipelineIsoOpen', 'Open pipeline'), values: data.open, color: 'var(--brand-deep)' }]}
            front={[{ id: 'overdue', label: t('sectorView.pipelineIsoOverdue', 'Overdue'), values: data.overdue, color: 'var(--danger)' }]}
            format={fmtCompact}
            empty={t('sectorView.pipelineIsoEmpty', 'No open pipeline yet.')}
            className="mx-auto max-w-lg"
          />
        </>
      )}
    </Card>
  );
}
