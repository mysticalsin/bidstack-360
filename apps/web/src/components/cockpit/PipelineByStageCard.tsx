import { memo } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import type { usePipelineReport } from '@/hooks/usePipelineReport';
import { formatMoney, formatStage } from '@/lib/format';

interface Props {
  report: ReturnType<typeof usePipelineReport>['data'];
}

export const PipelineByStageCard = memo(function PipelineByStageCard({ report }: Props) {
  return (
    <Card>
      <SectionHeader title="Pipeline by stage" />
      <div style={{ padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!report ? (
          <LoadingSkeleton rows={4} />
        ) : (
          report.byStage.map((s) => (
            <div
              key={s.stage}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <Badge tone="purple">{formatStage(s.stage)}</Badge>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>
                  {s.count}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--fg-tertiary)' }}>
                  {formatMoney(s.valueSum, 'EUR')}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
});
