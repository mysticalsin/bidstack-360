import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';
import type { useOpportunities } from '@/hooks/useOpportunities';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { formatStage } from '@/lib/format';
import { springSoft } from '@/lib/motion';

interface Props {
  opps: ReturnType<typeof useOpportunities>;
  accountName?: string;
  items?: NonNullable<ReturnType<typeof useOpportunities>['data']>['items'];
}

export const RecentOpportunitiesCard = memo(function RecentOpportunitiesCard({
  opps,
  accountName,
  items,
}: Props) {
  const reducedMotion = useReducedMotion();
  const { formatMoney } = useFormatMoney();
  const { t } = useTranslation('crm');
  const visibleItems = items ?? opps.data?.items ?? [];
  const accountScoped = Boolean(accountName);
  return (
    <Card
      role="region"
      aria-label={
        accountScoped
          ? t('recentOpportunities.accountTitle', 'Account opportunities')
          : t('recentOpportunities.recentTitle', 'Recent opportunities')
      }
    >
      <SectionHeader
        title={
          accountScoped
            ? t('recentOpportunities.accountTitle', 'Account opportunities')
            : t('recentOpportunities.recentTitle', 'Recent opportunities')
        }
        caption={
          accountScoped
            ? t('recentOpportunities.accountCaption', 'Open opportunities linked to {{accountName}}', {
                accountName,
              })
            : t('recentOpportunities.recentCaption', 'Latest portfolio activity across all customers')
        }
        action={
          <Link
            to={
              accountScoped
                ? `/opportunities?search=${encodeURIComponent(accountName ?? '')}`
                : '/opportunities'
            }
            className="link-arrow"
          >
            {accountScoped
              ? t('recentOpportunities.openPipeline', 'Open pipeline')
              : t('recentOpportunities.viewAll', 'View all')}{' '}
            <Icon name="arrow" size={12} />
          </Link>
        }
      />
      {opps.isLoading ? (
        <LoadingSkeleton rows={3} />
      ) : visibleItems.length === 0 ? (
        <EmptyState
          title={
            accountScoped
              ? t('recentOpportunities.emptyAccountTitle', 'No opportunities for this account yet')
              : t('recentOpportunities.emptyTitle', 'No opportunities yet')
          }
          message={
            accountScoped
              ? t(
                  'recentOpportunities.emptyAccountMessage',
                  'Create an opportunity from the account header to start a bid workspace.',
                )
              : undefined
          }
        />
      ) : (
        <ul className="proto-list-flat">
          {visibleItems.slice(0, 5).map((o, index) => (
            <motion.li
              key={o.id}
              className="proto-row"
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.035 }}
            >
              <Link to={`/opportunities/${o.id}`} className="proto-row-link">
                <div className="proto-row-main">
                  <span className="proto-row-code">{o.code}</span>
                  <span className="proto-row-name">{o.name}</span>
                  {!accountScoped ? <span className="proto-row-meta">{o.customer}</span> : null}
                </div>
                <div className="proto-row-right">
                  <span className="proto-row-money">
                    <AnimatedMetric value={formatMoney(o.value, 'EUR')} />
                  </span>
                  <Badge tone="purple">{formatStage(o.stage ?? 'unknown')}</Badge>
                </div>
              </Link>
            </motion.li>
          ))}
        </ul>
      )}
    </Card>
  );
});
