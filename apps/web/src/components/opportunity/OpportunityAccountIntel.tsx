// Compact account intel card for the opportunity detail page.
// Shows the related account's solutions & products so reps have context
// when crafting proposals or qualifying deals.

import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { useAccountIntel } from '@/hooks/useAccountIntel';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { Icon } from '@/components/ui/Icon';
import { staggerParent, staggerChild } from '@/lib/motion';

interface Props {
  accountId: string;
}

export function OpportunityAccountIntel({ accountId }: Props) {
  const intel = useAccountIntel(accountId);
  const reducedMotion = useReducedMotion();
  const { t } = useTranslation('crm');

  if (intel.isError) {
    return (
      <Card>
        <SectionHeader title={t('opportunityAccountIntel.title', 'Account intel')} />
        <div className="p-4">
          <ErrorState
            title={t('opportunityAccountIntel.errorTitle', 'Failed to load')}
            message={intel.error?.message}
          />
        </div>
      </Card>
    );
  }

  if (intel.isLoading) {
    return (
      <Card>
        <SectionHeader title={t('opportunityAccountIntel.title', 'Account intel')} />
        <div className="p-4">
          <TableSkeleton rows={3} columns={1} headless />
        </div>
      </Card>
    );
  }

  const solutions = intel.data?.solutions ?? [];
  const products = intel.data?.products ?? [];

  if (solutions.length === 0 && products.length === 0) {
    return (
      <Card>
        <SectionHeader title={t('opportunityAccountIntel.title', 'Account intel')} caption={accountId} />
        <div className="p-4">
          <EmptyState
            title={t('opportunityAccountIntel.emptyTitle', 'No intelligence yet')}
            message={t(
              'opportunityAccountIntel.emptyMessage',
              'Upload documents in the account cockpit to extract solutions & products.',
            )}
          />
        </div>
      </Card>
    );
  }

  return (
    <motion.div
      className="space-y-3"
      variants={reducedMotion ? undefined : staggerParent}
      initial={reducedMotion ? false : 'initial'}
      animate="animate"
    >
      <Card>
        <SectionHeader
          title={t('opportunityAccountIntel.title', 'Account intel')}
          caption={t(
            'opportunityAccountIntel.caption',
            '{{solutionCount}} solutions · {{productCount}} products',
            { solutionCount: solutions.length, productCount: products.length },
          )}
        />
        <div className="px-4 pb-4 space-y-4">
          {solutions.length > 0 && (
            <motion.div variants={reducedMotion ? undefined : staggerChild}>
              <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                {t('opportunityAccountIntel.solutionsHeading', 'Solutions')}
              </h4>
              <ul className="space-y-1.5">
                {solutions.slice(0, 5).map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 text-xs text-[var(--fg-secondary)]"
                  >
                    <Icon name="check" size={12} className="shrink-0 text-[var(--success)]" />
                    <span className="font-medium text-[var(--fg-primary)]">{s.name}</span>
                    <span className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] text-[var(--fg-tertiary)]">
                      {s.category}
                    </span>
                  </li>
                ))}
                {solutions.length > 5 && (
                  <li className="text-[10px] text-[var(--fg-tertiary)] pl-5">
                    {t('opportunityAccountIntel.moreSolutions', '+{{count}} more', {
                      count: solutions.length - 5,
                    })}
                  </li>
                )}
              </ul>
            </motion.div>
          )}

          {products.length > 0 && (
            <motion.div variants={reducedMotion ? undefined : staggerChild}>
              <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                {t('opportunityAccountIntel.productsHeading', 'Products')}
              </h4>
              <ul className="space-y-1.5">
                {products.slice(0, 5).map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-2 text-xs text-[var(--fg-secondary)]"
                  >
                    <Icon name="box" size={12} className="shrink-0 text-[var(--info)]" />
                    <span className="font-medium text-[var(--fg-primary)]">{p.name}</span>
                    <span className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] text-[var(--fg-tertiary)]">
                      {p.category}
                    </span>
                  </li>
                ))}
                {products.length > 5 && (
                  <li className="text-[10px] text-[var(--fg-tertiary)] pl-5">
                    {t('opportunityAccountIntel.moreProducts', '+{{count}} more', {
                      count: products.length - 5,
                    })}
                  </li>
                )}
              </ul>
            </motion.div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}
