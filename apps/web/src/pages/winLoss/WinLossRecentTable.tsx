// Recent closed bids — sortable, deep-links each row to the opportunity so a
// bid director can jump from "we lost this on price" to the full record.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { SortableHeader, getSortableHeaderAriaSort } from '@/components/ui/SortableHeader';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { useTableSort } from '@/hooks/useTableSort';
import { REASON_LABELS } from '@/pages/winLoss/reasonLabels';
import type { WinLossClosedRow } from '@/pages/winLoss/useWinLossAnalysis';

type SortKey = 'name' | 'customer' | 'outcome' | 'reason' | 'value' | 'owner' | 'decidedAt';

const ACCESSORS: Record<SortKey, (r: WinLossClosedRow) => string | number | null> = {
  name: (r) => r.name,
  customer: (r) => r.customer,
  outcome: (r) => r.outcome,
  reason: (r) => r.reason,
  // Precision loss past 2^53 micros is irrelevant for ordering.
  value: (r) => Number(r.valueMicros),
  owner: (r) => r.ownerName,
  decidedAt: (r) => r.decidedAt,
};

export function WinLossRecentTable({ rows }: { rows: WinLossClosedRow[] }) {
  const { t } = useTranslation('crm');
  // Currency-aware formatter converts the EUR-at-rest valueMicros into the
  // user's selected display currency; the raw @/lib/format formatter only
  // re-labels the symbol without applying the FX conversion.
  const { formatMoneyMicros } = useFormatMoney();
  const { state, setState, sorted } = useTableSort<WinLossClosedRow, SortKey>(rows, ACCESSORS, {
    initial: { key: 'decidedAt', dir: 'desc' },
  });

  const header = (key: SortKey, label: string, align: 'left' | 'right' = 'left') => (
    <th
      className={`px-4 py-2 font-medium ${align === 'right' ? 'text-right' : ''}`}
      aria-sort={getSortableHeaderAriaSort(key, state)}
    >
      <SortableHeader columnKey={key} state={state} onChange={setState} align={align}>
        {label}
      </SortableHeader>
    </th>
  );

  return (
    <Card className="overflow-hidden">
      <div className="px-4 pt-4">
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
          {t('winLoss.recentTitle', 'Recent closed bids')}
        </h2>
        <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
          {t('winLoss.recentSubtitle', 'Latest recorded outcomes in this range — open one to debrief.')}
        </p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--fg-tertiary)]">
              {header('name', t('winLoss.colOpportunity', 'Opportunity'))}
              {header('customer', t('winLoss.colCustomer', 'Customer'))}
              {header('outcome', t('winLoss.colOutcome', 'Outcome'))}
              {header('reason', t('winLoss.colReason', 'Reason'))}
              {header('value', t('winLoss.colValue', 'Value'), 'right')}
              {header('owner', t('winLoss.colOwner', 'Owner'))}
              {header('decidedAt', t('winLoss.colDecided', 'Recorded'))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.opportunityId}
                data-testid={`win-loss-row-${row.opportunityId}`}
                className="border-b border-[var(--border)] last:border-b-0"
              >
                <td className="px-4 py-3 align-top">
                  <Link
                    to={`/opportunities/${row.opportunityId}`}
                    className="font-medium text-[var(--brand-primary)] hover:underline"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="px-4 py-3 align-top text-[var(--fg-secondary)]">{row.customer}</td>
                <td className="px-4 py-3 align-top">
                  <Badge tone={row.outcome === 'won' ? 'jade' : 'tomato'}>
                    {row.outcome === 'won'
                      ? t('winLoss.outcomeWon', 'Won')
                      : t('winLoss.outcomeLost', 'Lost')}
                  </Badge>
                </td>
                <td className="px-4 py-3 align-top text-xs text-[var(--fg-secondary)]">
                  {t(REASON_LABELS[row.reason].key, REASON_LABELS[row.reason].label)}
                  {row.competitor ? (
                    <span className="block text-[var(--fg-tertiary)]">{row.competitor}</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-[var(--fg-secondary)]">
                  {formatMoneyMicros(row.valueMicros, 'EUR')}
                </td>
                <td className="px-4 py-3 align-top text-xs text-[var(--fg-tertiary)]">
                  {row.ownerName ?? t('winLoss.unowned', 'Unowned')}
                </td>
                <td className="px-4 py-3 align-top text-xs text-[var(--fg-tertiary)]">
                  {row.decidedAt.slice(0, 10)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
