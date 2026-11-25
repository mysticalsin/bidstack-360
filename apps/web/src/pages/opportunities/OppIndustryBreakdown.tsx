// Collapsible "Pipeline by industry" panel for the Opportunities page.
// With no list filter it uses the territory aggregate (every open bid).
// A stage, due, or search filter uses the rows on this page instead, so the
// header does not keep reading as the whole book. Collapsed by default.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { useTerritorySegments } from '@/hooks/useTerritories';
import { TerritorySegmentBreakdown } from '@/components/territories/TerritorySegmentBreakdown';

import { industrySplitFromPage, type PageIndustryBid } from './industry-page-split';

export function OppIndustryBreakdown({
  filtered = false,
  rows = [],
  pageContinues = false,
  listLoading = false,
}: {
  /** Stage, due, or search is on. The territory aggregate is the whole open book. */
  filtered?: boolean;
  /** Rows on this page. Used only while `filtered` is set. */
  rows?: readonly PageIndustryBid[];
  /** The list read one bid past this page and dropped it. */
  pageContinues?: boolean;
  /** The filtered list has not settled. Hold the book total off the header. */
  listLoading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('crm');
  const { formatMoneyMicros } = useFormatMoney();
  const segments = useTerritorySegments('industry');
  const book = segments.data?.totals;
  const page = industrySplitFromPage(rows);
  const showPage = filtered && !listLoading;
  const scope = pageContinues
    ? t('oppIndustryBreakdown.pagePartial', 'This page, not every match')
    : t('oppIndustryBreakdown.thisFilter', 'This filter');

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
          {t('oppIndustryBreakdown.title', 'Pipeline by industry')}
          {showPage ? (
            <span className="text-xs font-normal text-[var(--fg-tertiary)]">
              {scope}
              {' · '}
              {t('oppIndustryBreakdown.sectorCount', '{{count}} sector', {
                count: page.totalSegments,
              })}{' '}
              · {formatMoneyMicros(page.totalValueMicros, 'EUR')}
            </span>
          ) : !filtered && book ? (
            <span className="text-xs font-normal text-[var(--fg-tertiary)]">
              {t('oppIndustryBreakdown.sectorCount', '{{count}} sector', {
                count: book.totalSegments,
              })}{' '}
              · {formatMoneyMicros(book.totalValueMicros, 'EUR')}
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
          {filtered && listLoading ? (
            <TerritorySegmentBreakdown
              dimension="industry"
              segments={[]}
              isLoading
              isError={false}
              onRetry={() => undefined}
              formatMoneyMicros={formatMoneyMicros}
            />
          ) : showPage && page.items.length === 0 ? (
            <p className="px-1 py-6 text-sm text-[var(--fg-secondary)]">
              {t('oppIndustryBreakdown.filterEmpty', 'Nothing in this filter.')}
            </p>
          ) : showPage ? (
            <TerritorySegmentBreakdown
              dimension="industry"
              segments={page.items}
              isLoading={false}
              isError={false}
              onRetry={() => undefined}
              formatMoneyMicros={formatMoneyMicros}
            />
          ) : (
            <TerritorySegmentBreakdown
              dimension="industry"
              segments={segments.data?.items ?? []}
              isLoading={segments.isLoading}
              isError={segments.isError}
              errorMessage={segments.error instanceof Error ? segments.error.message : undefined}
              onRetry={() => void segments.refetch()}
              formatMoneyMicros={formatMoneyMicros}
            />
          )}
        </div>
      ) : null}
    </Card>
  );
}
