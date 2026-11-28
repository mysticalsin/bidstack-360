import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { api } from '@/lib/api';
import { formatStage } from '@/lib/format';
import { springSoft } from '@/lib/motion';

import type { OpportunityPage } from '@bidstack/shared';

import {
  ACCOUNT_STAGE_PAGE,
  accountCompanyId,
  accountStageBars,
} from './account-stage-bars';

interface Props {
  companyId: string;
  accountName: string;
}

export const PipelineByStageCard = memo(function PipelineByStageCard({
  companyId,
  accountName,
}: Props) {
  const reducedMotion = useReducedMotion();
  const { formatMoney } = useFormatMoney();
  const { t } = useTranslation('crm');
  const id = accountCompanyId(companyId);
  const deals = useQuery({
    queryKey: ['opportunities', 'account-stage', id],
    enabled: id !== null,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        companyId: id ?? '',
        limit: String(ACCOUNT_STAGE_PAGE),
      });
      return api<OpportunityPage>(`/api/opportunities?${params.toString()}`, { signal });
    },
  });

  const region = t('pipelineByStage.accountRegion', '{{account}} pipeline by stage', {
    account: accountName,
  });
  const title = t('pipelineByStage.accountTitle', 'Pipeline by stage');
  const caption = t('pipelineByStage.accountCaption', 'Bids on {{account}}', {
    account: accountName,
  });

  if (id === null) {
    return (
      <Card role="region" aria-label={region}>
        <SectionHeader title={title} caption={caption} />
        <EmptyState
          title={t('pipelineByStage.unlinkedTitle', 'No company record')}
          message={t(
            'pipelineByStage.unlinked',
            'This account is not linked to a company record.',
          )}
        />
      </Card>
    );
  }

  if (deals.isLoading) {
    return (
      <Card role="region" aria-label={region}>
        <SectionHeader title={title} caption={caption} />
        <LoadingSkeleton rows={4} />
      </Card>
    );
  }

  if (deals.isError && !deals.data) {
    return (
      <Card role="region" aria-label={region}>
        <SectionHeader title={title} caption={caption} />
        <ErrorState
          title={t('pipelineByStage.errorTitle', "Couldn't load this account's pipeline")}
          message={t(
            'pipelineByStage.errorMessage',
            'The stage totals for this account did not load.',
          )}
          action={
            <Button variant="secondary" size="lg" onClick={() => void deals.refetch()}>
              {t('pipelineByStage.retry', 'Retry')}
            </Button>
          }
        />
      </Card>
    );
  }

  const items = deals.data?.items ?? [];
  const bars = accountStageBars(items);
  const maxValue = Math.max(1, ...bars.map((stage) => stage.valueSum));
  const pageContinues = Boolean(deals.data?.nextCursor);

  return (
    <Card role="region" aria-label={region}>
      <SectionHeader title={title} caption={caption} />
      <div style={{ padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pageContinues ? (
          <p className="text-sm text-[var(--fg-secondary)]" role="status">
            {t(
              'pipelineByStage.pagePartial',
              'These bars are the first {{count}} bids on this account, not every bid.',
              { count: ACCOUNT_STAGE_PAGE },
            )}
          </p>
        ) : null}
        {bars.length === 0 ? (
          <EmptyState
            title={t('pipelineByStage.emptyTitle', 'No bids on this account yet')}
            message={t(
              'pipelineByStage.emptyMessage',
              'Bids linked to this company will show up here.',
            )}
          />
        ) : (
          bars.map((stage, index) => (
            <motion.div
              key={stage.stage}
              className="stage-pipeline-row"
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.045 }}
            >
              <div className="stage-pipeline-head">
                <Badge tone="purple">{formatStage(stage.stage)}</Badge>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>
                    <AnimatedMetric value={stage.count.toLocaleString()} />
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--fg-tertiary)' }}>
                    <AnimatedMetric value={formatMoney(stage.valueSum, 'EUR')} />
                  </div>
                </div>
              </div>
              <div className="stage-bar-track" aria-hidden>
                <motion.span
                  className="stage-bar-fill"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: Math.max(0.08, stage.valueSum / maxValue) }}
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
