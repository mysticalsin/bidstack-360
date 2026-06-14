// Collapsible "Pipeline by industry" panel for the Opportunities page. Reuses
// the territory segments endpoint (dimension=industry), which aggregates the
// org's opportunities by their account's industry — "the bids we're working on,
// split by sector". Collapsed by default so the table stays the focus.
import { useState } from 'react';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { useTerritorySegments } from '@/hooks/useTerritories';
import { TerritorySegmentBreakdown } from '@/components/territories/TerritorySegmentBreakdown';

export function OppIndustryBreakdown() {
  const [open, setOpen] = useState(false);
  const { formatMoney } = useFormatMoney();
  const segments = useTerritorySegments('industry');
  const totals = segments.data?.totals;

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
      >
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--fg-primary)]">
          <Icon name="globe" size={15} ariaHidden />
          Pipeline by industry
          {totals ? (
            <span className="text-xs font-normal text-[var(--fg-tertiary)]">
              {totals.totalSegments} sector{totals.totalSegments === 1 ? '' : 's'} ·{' '}
              {formatMoney(totals.totalValueMicros, 'EUR')}
            </span>
          ) : null}
        </span>
        <Icon
          name="chevron-down"
          size={14}
          className={cn('shrink-0 transition-transform', open && 'rotate-180')}
          ariaHidden
        />
      </button>
      {open ? (
        <div className="border-t border-[var(--border-subtle)] p-4">
          <TerritorySegmentBreakdown
            dimension="industry"
            segments={segments.data?.items ?? []}
            isLoading={segments.isLoading}
            isError={segments.isError}
            errorMessage={segments.error instanceof Error ? segments.error.message : undefined}
            onRetry={() => void segments.refetch()}
            formatMoneyMicros={formatMoney}
          />
        </div>
      ) : null}
    </Card>
  );
}
