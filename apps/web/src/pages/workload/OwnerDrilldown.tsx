// Inline drill-through under an expanded workload row: the owner's live bids,
// each linking to its opportunity. Mounted only while expanded, so the fetch
// fires on demand (the opportunities list API filters by owner email).

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  formatRecordedDealAmount,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';
import { DueDateChip } from '@/components/ui/DueDateChip';
import { Icon } from '@/components/ui/Icon';
import { useOpportunities } from '@/hooks/useOpportunities';
import { closedOutcome } from '@/lib/pipeline-stages';
import type { Opportunity } from '@bidstack/shared';

interface Props {
  /** Owner email — the filter key the opportunities API understands. */
  email: string;
  ownerLabel: string;
}

function isOpen(o: Opportunity): boolean {
  return closedOutcome(o) === null;
}

export function OwnerDrilldown({ email, ownerLabel }: Props) {
  const { t } = useTranslation('crm');
  const opps = useOpportunities({ owner: email, limit: 200 });

  if (opps.isLoading) {
    return (
      <div className="space-y-2 px-5 py-4" aria-busy="true" aria-live="polite">
        <div className="bs-shimmer h-8" />
        <div className="bs-shimmer h-8" />
      </div>
    );
  }

  if (opps.isError) {
    return (
      <p role="alert" className="px-5 py-4 text-xs text-[var(--danger)]">
        {t('workload.drilldownError', "Couldn't load {{owner}}'s bids — expand again to retry.", {
          owner: ownerLabel,
        })}
      </p>
    );
  }

  const open = (opps.data?.items ?? []).filter(isOpen);
  if (open.length === 0) {
    return (
      <p className="px-5 py-4 text-xs text-[var(--fg-tertiary)]">
        {t('workload.drilldownEmpty', 'No live bids on this desk right now.')}
      </p>
    );
  }

  return (
    <div>
      <p className="px-5 pt-3 text-[10px] text-[var(--fg-tertiary)]">
        {t(
          'workload.drilldownBasis',
          'Open bids for {{owner}}. Amounts are opportunity value in major units. {{basis}}',
          { owner: ownerLabel, basis: UNSPECIFIED_CURRENCY_BASIS },
        )}
      </p>
      <ul className="divide-y divide-[var(--border-subtle)]">
        {open.map((o) => (
          <li key={o.id}>
            <Link
              to={`/opportunities/${o.id}`}
              className="flex min-h-[44px] flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2 text-xs hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--border-focus)] dark:hover:bg-[var(--row-hover-tint)]"
            >
              <span className="font-mono text-[11px] text-[var(--fg-tertiary)]">{o.code}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-[var(--fg-primary)]">
                {o.customer} — {o.name}
              </span>
              <span className="tabular-nums text-[var(--fg-secondary)]">
                {formatRecordedDealAmount(o, 'compact')}
              </span>
              <DueDateChip dueDate={o.dueDate} size="sm" />
              <Icon name="chevron-right" size={12} className="text-[var(--fg-tertiary)]" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
