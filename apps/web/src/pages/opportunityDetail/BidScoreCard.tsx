// Bid/No-Bid score card — owns the useBidScoreLatest hook and renders the
// score, recommendation badge, and a drill-through link to the bid matrix.
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { useBidScoreLatest } from '@/hooks/useBidScore';

export function BidScoreCard({ opportunityId }: { opportunityId: string }) {
  const { data, isLoading } = useBidScoreLatest(opportunityId);

  return (
    <Card>
      <SectionHeader title="Bid/No-Bid Score" />
      <div className="p-5 flex flex-col justify-between h-[calc(100%-48px)] min-h-[140px]">
        {isLoading ? (
          <div className="space-y-3">
            <div className="h-8 w-24 bg-[var(--surface-sunken)] animate-pulse rounded" />
            <div className="h-4 w-32 bg-[var(--surface-sunken)] animate-pulse rounded" />
          </div>
        ) : data ? (
          <div className="space-y-4 flex flex-col justify-between h-full">
            <div className="space-y-2">
              <div className="flex items-baseline gap-2">
                <div className="text-4xl font-bold tabular-nums text-[var(--fg-primary)]">
                  {data.totalScore.toFixed(0)}%
                </div>
                <div className="text-xs text-[var(--fg-tertiary)]">overall score</div>
              </div>
              <div>
                <Badge
                  tone={
                    data.recommendation === 'bid'
                      ? 'jade'
                      : data.recommendation === 'no_bid'
                        ? 'tomato'
                        : 'amber'
                  }
                  className="px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider"
                >
                  {data.recommendation === 'bid'
                    ? 'Bid'
                    : data.recommendation === 'no_bid'
                      ? 'No-Bid'
                      : 'Conditional Bid'}
                </Badge>
              </div>
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
