// Opportunity breakdown by a business dimension (industry / account), the
// non-geographic counterpart to the world map. Ranked horizontal value bars so
// the biggest segments read at a glance. All four data states handled.

import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import type { SegmentDimension, TerritorySegment } from '@/hooks/useTerritories';

export function TerritorySegmentBreakdown({
  dimension,
  segments,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  formatMoneyMicros,
}: {
  dimension: SegmentDimension;
  segments: TerritorySegment[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  formatMoneyMicros: (micros: number, currency: string) => string;
}) {
  const { t } = useTranslation('crm');

  // Per-dimension prose: the noun used in titles/overflow, and the empty-state hint.
  const dimensionNoun: Record<SegmentDimension, string> = {
    industry: t('territorySegmentBreakdown.nounIndustry', 'industry'),
    account: t('territorySegmentBreakdown.nounAccount', 'account'),
    country: t('territorySegmentBreakdown.nounCountry', 'country'),
  };
  const dimensionEmpty: Record<SegmentDimension, string> = {
    industry: t('territorySegmentBreakdown.emptyIndustry', 'Opportunities need an industry to appear here.'),
    account: t('territorySegmentBreakdown.emptyAccount', 'Opportunities need a linked account to appear here.'),
    country: t('territorySegmentBreakdown.emptyCountry', 'Opportunities need a country to appear here.'),
  };

  if (isError) {
    return (
      <ErrorState
        title={t('territorySegmentBreakdown.errorTitle', 'Failed to load {{noun}} breakdown', {
          noun: dimensionNoun[dimension],
        })}
        message={errorMessage ?? t('territorySegmentBreakdown.errorMessage', 'The server rejected the request.')}
        action={<Button onClick={onRetry}>{t('territorySegmentBreakdown.retry', 'Retry')}</Button>}
      />
    );
  }
  if (isLoading) {
    return (
      <div className="h-[420px] flex items-center justify-center">
        <TableSkeleton rows={6} columns={3} headless />
      </div>
    );
  }
  if (segments.length === 0) {
    return (
      <div className="h-[420px] flex items-center justify-center">
        <EmptyState
          title={t('territorySegmentBreakdown.emptyTitle', 'No data yet')}
          message={dimensionEmpty[dimension]}
        />
      </div>
    );
  }

  // Bar width is proportional to value share of the largest segment.
  const maxValue = Math.max(...segments.map((s) => s.totalValueMicros), 1);
  // Cap the visible rows; surface the overflow rather than silently truncating.
  const VISIBLE = 18;
  const shown = segments.slice(0, VISIBLE);
  const hidden = segments.length - shown.length;

  return (
    <div className="p-4">
      <ul className="space-y-2">
        {shown.map((s) => {
          const widthPct = Math.max(2, Math.round((s.totalValueMicros / maxValue) * 100));
          return (
            <li
              key={s.key}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium text-[var(--fg-primary)]" title={s.label}>
                  {s.label}
                </span>
                <span className="shrink-0 text-sm font-semibold text-[var(--fg-primary)]">
                  {formatMoneyMicros(s.totalValueMicros, 'EUR')}
                </span>
              </div>
              {/* Value bar */}
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                <div
                  className="h-full rounded-full bg-[var(--brand-primary)] dark:bg-gradient-to-r dark:from-[var(--brand-gradient-start)] dark:to-[var(--brand-gradient-end)]"
                  style={{ width: `${widthPct}%` }}
                  aria-hidden
                />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--fg-secondary)]">
                <span>
                  {s.opportunityCount === 1
                    ? t('territorySegmentBreakdown.oppCountOne', '{{count}} opp', {
                        count: s.opportunityCount,
                      })
                    : t('territorySegmentBreakdown.oppCountOther', '{{count}} opps', {
                        count: s.opportunityCount,
                      })}
                </span>
                <span aria-hidden>·</span>
                <span>
                  {t('territorySegmentBreakdown.avgProbability', '{{percent}}% avg probability', {
                    percent: s.avgProbability,
                  })}
                </span>
                {s.ownerNames.length > 0 ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="truncate">{s.ownerNames.slice(0, 3).join(', ')}</span>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? (
        <p className="mt-3 text-center text-xs text-[var(--fg-tertiary)]">
          {hidden === 1
            ? t('territorySegmentBreakdown.overflowOne', '+ {{count}} more {{noun}} not shown', {
                count: hidden,
                noun: dimensionNoun[dimension],
              })
            : dimension === 'industry'
              ? t(
                  'territorySegmentBreakdown.overflowIndustryOther',
                  '+ {{count}} more {{noun}} segments not shown',
                  { count: hidden, noun: dimensionNoun[dimension] },
                )
              : t('territorySegmentBreakdown.overflowOther', '+ {{count}} more {{noun}}s not shown', {
                  count: hidden,
                  noun: dimensionNoun[dimension],
                })}
        </p>
      ) : null}
    </div>
  );
}
