// Bid/No-Bid score card — owns the useBidScoreLatest hook and renders the
// composite score, recommendation badge, per-criteria breakdown, category
// scores, override badge (justification on hover/focus), and a drill-through
// link to the bid matrix. Read-tolerant: criterion ids from older score
// versions render with their legacy label and stored rating instead of
// crashing or disappearing.
import { Link } from 'react-router-dom';
import { bidCriterionById, bidCriterionLabel } from '@bidstack/shared';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Tooltip } from '@/components/ui/Tooltip';
import { useBidScoreLatest } from '@/hooks/useBidScore';

import { CATEGORY_INFO } from '../bidNoBid/bidNoBidTypes';

const REC_TONE = { bid: 'jade', no_bid: 'tomato', proceed_with_caution: 'amber' } as const;
const REC_LABEL = {
  bid: 'Bid',
  no_bid: 'No-Bid',
  proceed_with_caution: 'Conditional Bid',
} as const;

function CriteriaBreakdown({ criteria }: { criteria: Record<string, number> }) {
  const rows = Object.entries(criteria)
    .filter(([, rating]) => rating > 0)
    .sort(([a], [b]) => bidCriterionLabel(a).localeCompare(bidCriterionLabel(b)));
  if (rows.length === 0) return null;

  return (
    <ul className="space-y-1" aria-label="Criteria breakdown">
      {rows.map(([id, rating]) => {
        const def = bidCriterionById(id);
        const points = def ? ((rating / 5) * def.weight).toFixed(1) : null;
        return (
          <li key={id} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-[var(--fg-secondary)]">{bidCriterionLabel(id)}</span>
            <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
              <span className="text-[var(--fg-primary)]">{rating}/5</span>
              <span className="w-14 text-right text-[var(--fg-tertiary)]">
                {points !== null ? `${points}/${def?.weight} pts` : '—'}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function CategoryScores({ categoryScores }: { categoryScores: Record<string, number> }) {
  const entries = Object.entries(categoryScores);
  if (entries.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1" aria-label="Category scores">
      {entries.map(([cat, value]) => (
        <div key={cat} className="flex items-center justify-between gap-2 text-[11px]">
          <span className="truncate text-[var(--fg-tertiary)]">
            {CATEGORY_INFO[cat]?.label ?? cat}
          </span>
          <span
            className="font-semibold tabular-nums"
            style={{ color: CATEGORY_INFO[cat]?.color ?? 'var(--fg-secondary)' }}
          >
            {Math.round(value)}%
          </span>
        </div>
      ))}
    </div>
  );
}

export function BidScoreCard({ opportunityId }: { opportunityId: string }) {
  const { data, isLoading, isError, error } = useBidScoreLatest(opportunityId);
  // 404 = "not scored yet" (empty state); anything else is a real failure.
  const notFound = (error as { status?: number } | null)?.status === 404;

  return (
    <Card>
      <SectionHeader title="Bid/No-Bid Score" />
      <div className="p-5 flex flex-col justify-between h-[calc(100%-48px)] min-h-[140px]">
        {isLoading ? (
          <div className="space-y-3">
            <div className="h-8 w-24 bg-[var(--surface-sunken)] animate-pulse rounded" />
            <div className="h-4 w-32 bg-[var(--surface-sunken)] animate-pulse rounded" />
            <div className="h-16 w-full bg-[var(--surface-sunken)] animate-pulse rounded" />
          </div>
        ) : isError && !notFound ? (
          <p role="alert" className="text-xs text-[var(--danger)]">
            Could not load the bid score. Refresh to try again.
          </p>
        ) : data ? (
          <div className="space-y-4 flex flex-col justify-between h-full">
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <div className="text-4xl font-bold tabular-nums text-[var(--fg-primary)]">
                  {data.totalScore.toFixed(0)}%
                </div>
                <div className="text-xs text-[var(--fg-tertiary)]">overall score</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={REC_TONE[data.recommendation]}
                  className="px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider"
                >
                  {REC_LABEL[data.recommendation]}
                </Badge>
                {data.overrideJustification ? (
                  <Tooltip content={data.overrideJustification}>
                    <span
                      tabIndex={0}
                      className="inline-flex cursor-help rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                    >
                      <Badge
                        tone="amber"
                        className="px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider"
                      >
                        Overridden
                      </Badge>
                    </span>
                  </Tooltip>
                ) : null}
              </div>
              <CriteriaBreakdown criteria={data.criteria} />
              <CategoryScores categoryScores={data.categoryScores} />
            </div>
            <div className="pt-2">
              <Link to={`/bid-matrix?opportunityId=${opportunityId}`} className="block">
                <Button variant="secondary" size="sm" className="w-full text-xs">
                  Details
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4 flex flex-col justify-between h-full">
            <p className="text-xs text-[var(--fg-tertiary)]">
              No bid evaluation score has been recorded for this opportunity yet.
            </p>
            <div>
              <Link to={`/bid-matrix?opportunityId=${opportunityId}`} className="block">
                <Button variant="secondary" size="sm" className="w-full text-xs">
                  Evaluate Now
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
