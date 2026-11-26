import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
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
  // A settled empty book is a real zero. A failed read has no book to count,
  // and a failed refresh keeps the last payload instead of painting that zero.
  const loaded = opps.data != null;
  const failed = opps.isError && !opps.isLoading;
  const fatal = failed && !loaded && visibleItems.length === 0;
  const stale = failed && (loaded || visibleItems.length > 0);
  const retryLabel = t('recentOpportunities.retry', 'Retry');
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
      {opps.isLoading && visibleItems.length === 0 ? (
        <LoadingSkeleton rows={3} />
      ) : fatal ? (
        <ErrorState
          title={
            accountScoped
              ? t(
                  'recentOpportunities.errorAccountTitle',
                  "Couldn't load opportunities for {{accountName}}",
                  { accountName },
                )
              : t('recentOpportunities.errorTitle', "Couldn't load recent opportunities")
          }
          message={t('recentOpportunities.errorMessage', 'The deal book did not load.')}
          action={<RetryButton label={retryLabel} onRetry={() => void opps.refetch()} />}
        />
      ) : (
        <>
          {stale ? (
            <div
              role="status"
              className="mx-5 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--tag-amber-bg)] px-3 py-1 text-sm text-[var(--tag-amber-fg)]"
            >
              <span>
                {t(
                  'recentOpportunities.staleRefresh',
                  'Refresh failed. Showing the last loaded opportunities.',
                )}
              </span>
              <RetryButton label={retryLabel} onRetry={() => void opps.refetch()} />
            </div>
          ) : null}
          {visibleItems.length === 0 ? (
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
                      <span className="proto-row-name" title={o.name}>{o.name}</span>
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
        </>
      )}
    </Card>
  );
});

function RetryButton({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <button
      type="button"
      className="min-h-[44px] rounded-md px-2 font-semibold underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
      onClick={onRetry}
    >
      {label}
    </button>
  );
}
