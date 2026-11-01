import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import type { usePipelineReport } from '@/hooks/usePipelineReport';
import { formatStage } from '@/lib/format';
import {
  formatUnspecifiedCompactMicros,
  recordedMicros,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';
import { stageBarShares } from '@/components/dashboard/widgets/pipeline-headline';
import { springSoft } from '@/lib/motion';

interface Props {
  report: ReturnType<typeof usePipelineReport>['data'];
}

export const PipelineByStageCard = memo(function PipelineByStageCard({ report }: Props) {
  const reducedMotion = useReducedMotion();
  const { t } = useTranslation('crm');
  const shares = report ? stageBarShares(report.byStage) : [];
  return (
    <Card role="region" aria-label={t('pipelineByStage.regionLabel', 'Portfolio pipeline by stage')}>
      <SectionHeader
        title={t('pipelineByStage.title', 'Portfolio pipeline')}
        caption={t(
          'pipelineByStage.caption',
          'Org-wide stages, not this account alone. Bar length is unspecified pipeline share. {{basis}}',
          { basis: UNSPECIFIED_CURRENCY_BASIS },
        )}
      />
      <div style={{ padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!report ? (
          <LoadingSkeleton rows={4} />
        ) : (
          report.byStage.map((s, index) => (
            <motion.div
              key={s.stage}
              className="stage-pipeline-row"
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.045 }}
            >
              <div className="stage-pipeline-head">
                <Badge tone="purple">{formatStage(s.stage)}</Badge>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>
                    <AnimatedMetric value={`${s.count.toLocaleString()} deals`} />
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--fg-tertiary)' }}>
                    <AnimatedMetric
                      value={formatUnspecifiedCompactMicros(
                        recordedMicros(s.valueSum, s.valueSumMicros),
                      )}
                    />
                  </div>
                </div>
              </div>
              <div className="stage-bar-track" aria-hidden>
                <motion.span
                  className="stage-bar-fill"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: Math.max(0.08, (shares[index] ?? 0) / 100) }}
                  transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.045 + 0.08 }}
                />
              </div>
            </motion.div>
          ))
        )}
      </div>
    </Card>
  );
});
