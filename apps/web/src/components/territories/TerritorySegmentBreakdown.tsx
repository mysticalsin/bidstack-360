// Opportunity breakdown by a business dimension (industry / account), the
// non-geographic counterpart to the world map. Ranked horizontal value bars so
// the biggest segments read at a glance. All four data states handled.

import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import type { SegmentDimension, TerritorySegment } from '@/hooks/useTerritories';

const DIMENSION_LABEL: Record<SegmentDimension, { noun: string; empty: string }> = {
  industry: { noun: 'industry', empty: 'Opportunities need an industry to appear here.' },
  account: { noun: 'account', empty: 'Opportunities need a linked account to appear here.' },
  country: { noun: 'country', empty: 'Opportunities need a country to appear here.' },
};

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
  if (isError) {
    return (
      <ErrorState
        title={`Failed to load ${DIMENSION_LABEL[dimension].noun} breakdown`}
        message={errorMessage ?? 'The server rejected the request.'}
        action={<Button onClick={onRetry}>Retry</Button>}
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
        <EmptyState title="No data yet" message={DIMENSION_LABEL[dimension].empty} />
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
                  {s.opportunityCount} opp{s.opportunityCount === 1 ? '' : 's'}
                </span>
                <span aria-hidden>·</span>
                <span>{s.avgProbability}% avg probability</span>
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
          + {hidden} more {DIMENSION_LABEL[dimension].noun}
          {hidden === 1 ? '' : dimension === 'industry' ? ' segments' : 's'} not shown
        </p>
      ) : null}
    </div>
  );
}
