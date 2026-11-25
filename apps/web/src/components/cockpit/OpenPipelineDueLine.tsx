import { useTranslation } from 'react-i18next';

/**
 * The line under the account header's open-pipeline figure. A late open book
 * has to say so: the figure alone reads as a current plan.
 */
export function OpenPipelineDueLine({
  open,
  overdue,
  oldestOverdueDays,
}: {
  open: number;
  overdue: number;
  oldestOverdueDays: number;
}) {
  const { t } = useTranslation('crm');
  const openText =
    open === 1
      ? t('pageHead.keyOpenDeal', '1 open deal')
      : t('pageHead.keyOpenDeals', '{{count}} open deals', { count: open });
  if (overdue <= 0) return <span>{openText}</span>;

  // One late deal: the day count is the fact. Several: the count, or "all"
  // when every open deal has already passed its due day.
  const lateText =
    overdue === 1
      ? t('pageHead.keyOneDealOverdue', '{{days}}d overdue', { days: oldestOverdueDays })
      : overdue === open
        ? t('pageHead.keyAllDealsOverdue', 'all overdue')
        : t('pageHead.keySomeDealsOverdue', '{{count}} overdue', { count: overdue });

  return (
    <span>
      {openText}
      <span className="acct-key-late">
        {' · '}
        {lateText}
      </span>
    </span>
  );
}
