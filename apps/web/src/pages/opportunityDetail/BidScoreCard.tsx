// Bid/No-Bid score card: owns the useBidScoreLatest hook and renders the
// composite score, recommendation badge, the criteria as a radar against the
// go threshold, override badge (justification on hover/focus), and a
// drill-through link to the bid matrix. Criterion ids from older score
// versions are not in the registry, so they stay out of the radar.
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { bidCriteriaRadar } from '@/components/charts/bid-chart-data';
import { RadarChart } from '@/components/charts/tuffui/radar-chart';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Tooltip } from '@/components/ui/Tooltip';
import { useBidScoreLatest } from '@/hooks/useBidScore';

const REC_TONE = { bid: 'jade', no_bid: 'tomato', proceed_with_caution: 'amber' } as const;

const GO_LABEL = 'Go threshold';

function CriteriaRadar({ criteria }: { criteria: Record<string, number> }) {
  const { t } = useTranslation('crm');
  const radar = bidCriteriaRadar(criteria);
  if (radar.rated === 0) return null;
  return (
    <RadarChart
      title={t('bidScore.criteriaRadarLabel', 'Bid criteria')}
      axes={radar.axes}
      max={5}
      series={{ id: 'score', label: t('bidScore.thisBid', 'This bid'), values: radar.values }}
      baseline={{ label: t('bidScore.goThreshold', GO_LABEL), values: radar.baseline }}
    />
  );
}

export function BidScoreCard({ opportunityId }: { opportunityId: string }) {
  const { t } = useTranslation('crm');
  const { data, isLoading, isError, error } = useBidScoreLatest(opportunityId);
  // 404 = "not scored yet" (empty state); anything else is a real failure.
  const notFound = (error as { status?: number } | null)?.status === 404;

  const REC_LABEL = {
    bid: t('bidScore.recBid', 'Bid'),
    no_bid: t('bidScore.recNoBid', 'No-Bid'),
    proceed_with_caution: t('bidScore.recConditionalBid', 'Conditional Bid'),
  } as const;

  return (
    <Card>
      <SectionHeader title={t('bidScore.title', 'Bid/No-Bid Score')} />
      <div className="p-5 flex flex-col justify-between h-[calc(100%-48px)] min-h-[140px]">
        {isLoading ? (
          <div className="space-y-3">
            <div className="h-8 w-24 bg-[var(--surface-sunken)] animate-pulse rounded" />
            <div className="h-4 w-32 bg-[var(--surface-sunken)] animate-pulse rounded" />
            <div className="h-16 w-full bg-[var(--surface-sunken)] animate-pulse rounded" />
          </div>
        ) : isError && !notFound ? (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {t('bidScore.loadError', 'Could not load the bid score. Refresh to try again.')}
          </p>
        ) : data ? (
          <div className="space-y-4 flex flex-col justify-between h-full">
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <div className="text-4xl font-bold tabular-nums text-[var(--fg-primary)]">
                  {data.totalScore.toFixed(0)}%
                </div>
                <div className="text-xs text-[var(--fg-tertiary)]">
                  {t('bidScore.overallScore', 'overall score')}
                </div>
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
                        {t('bidScore.overridden', 'Overridden')}
                      </Badge>
                    </span>
                  </Tooltip>
                ) : null}
              </div>
              <CriteriaRadar criteria={data.criteria} />
            </div>
            <div className="pt-2">
              <Link to={`/bid-matrix?opportunityId=${opportunityId}`} className="block">
                <Button variant="secondary" size="sm" className="w-full text-xs">
                  {t('bidScore.detailsButton', 'Details')}
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4 flex flex-col justify-between h-full">
            <p className="text-xs text-[var(--fg-tertiary)]">
              {t(
                'bidScore.emptyState',
                'No bid evaluation score has been recorded for this opportunity yet.',
              )}
            </p>
            <div>
              <Link to={`/bid-matrix?opportunityId=${opportunityId}`} className="block">
                <Button variant="secondary" size="sm" className="w-full text-xs">
                  {t('bidScore.evaluateButton', 'Evaluate Now')}
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
