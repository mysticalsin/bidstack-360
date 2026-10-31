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
import { formatStage } from '@/lib/format';
import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';
import { springSoft } from '@/lib/motion';

export interface RecentOpportunityItem {
  id: string;
  code?: string | null;
  name: string;
  customer?: string | null;
  value: number;
  stage?: string | null;
}

/** Snapshot deals are micros. The card prints major units, once. */
export function recentItemsFromDeals(
  deals: ReadonlyArray<{
    id: string;
    name: string;
    stage: string;
    amountMicros: number;
    companyName: string | null;
  }>,
): RecentOpportunityItem[] {
  return deals.map((deal) => ({
    id: deal.id,
    name: deal.name,
    customer: deal.companyName,
    value: deal.amountMicros / 1_000_000,
    stage: deal.stage,
  }));
}

interface Props {
  opps?: ReturnType<typeof useOpportunities>;
  accountName?: string;
  items?: RecentOpportunityItem[];
}

export const RecentOpportunitiesCard = memo(function RecentOpportunitiesCard({
  opps,
  accountName,
  items,
}: Props) {
  const reducedMotion = useReducedMotion();
  const { t } = useTranslation('crm');
  const visibleItems = items ?? opps?.data?.items ?? [];
  const loading = items ? false : (opps?.isLoading ?? false);
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
      {loading ? (
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
                  {o.code ? <span className="proto-row-code">{o.code}</span> : null}
                  <span className="proto-row-name">{o.name}</span>
                  {!accountScoped ? <span className="proto-row-meta">{o.customer}</span> : null}
                </div>
                <div className="proto-row-right">
                  <span className="proto-row-money">
                    <AnimatedMetric value={formatUnspecifiedAmount(o.value)} />
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
