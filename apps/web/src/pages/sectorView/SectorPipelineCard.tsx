// Open pipeline per sector (back row) with its overdue part in front, from the
// same opportunity rows the dashboard charts use.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sectorPipeline } from '@/components/charts/bid-chart-data';
import { IsoBars } from '@/components/charts/tuffui/iso-bars';
import { Card } from '@/components/ui/Card';
import { fmtCompact } from '@/components/viz/viz-data';
import { useOpportunityRows } from '@/hooks/useOpportunityRows';

export function SectorPipelineCard() {
  const { t } = useTranslation('crm');
  const rows = useOpportunityRows();
  const [now] = useState(() => Date.now());
  const data = sectorPipeline(rows.data?.items ?? [], now);

  return (
    <Card className="p-4" data-testid="sector-pipeline-iso">
      <h2 className="mb-3 text-base font-semibold text-fg-primary">
        {t('sectorView.pipelineIsoTitle', 'Pipeline by sector')}
      </h2>
      {rows.isLoading ? (
        <p className="py-6 text-center text-sm text-fg-secondary">{t('sectorView.pipelineIsoLoading', 'Loading pipeline.')}</p>
      ) : (
        <IsoBars
          title={t('sectorView.pipelineIsoTitle', 'Pipeline by sector')}
          labels={data.labels}
          back={[{ id: 'open', label: t('sectorView.pipelineIsoOpen', 'Open pipeline'), values: data.open, color: 'var(--brand-deep)' }]}
          front={[{ id: 'overdue', label: t('sectorView.pipelineIsoOverdue', 'Overdue'), values: data.overdue, color: 'var(--danger)' }]}
          format={fmtCompact}
          empty={t('sectorView.pipelineIsoEmpty', 'No open pipeline yet.')}
          className="mx-auto max-w-2xl"
        />
      )}
    </Card>
  );
}
