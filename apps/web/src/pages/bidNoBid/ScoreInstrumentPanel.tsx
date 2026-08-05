// The bid-decision instrument panel — ROUND2-ULTRAPLAN's density retarget for
// this surface: "KPI row becomes one bordered StatGroup instrument panel (not
// floating cards)". It replaces ScoreSummaryStrip's five ProgressRings inside a
// GlassCard.
//
// ── COLOUR DISCIPLINE (this is the screen where it matters most) ────────────
// Four numbers, and exactly two carry colour:
//   · the composite's DELTA against the last saved score — a delta is the only
//     thing a green/red number is allowed to mean here, and it renders only when
//     there IS a saved score to differ from (StatCard infers the direction from
//     the sign, so the arrow and the colour always agree with the digits);
//   · the recommendation's DOT — semantic (good/warn/critical), 6px, beside a
//     neutral word. Never a filled pill: at four-up density a coloured block per
//     cell turns an instrument panel into a traffic light.
// The brand accent appears once on this page, on the primary Save button. It is
// deliberately absent from here.

import { useTranslation } from 'react-i18next';

import { BID_TOTAL_WEIGHT } from '@bidstack/shared';

import { StatGroup } from '@/components/table-kit/dashboard';
import { StatCard, type StatDelta } from '@/components/table-kit/stat-card';
import { StatusIndicator, type StatusTone } from '@/components/table-kit/status-indicator';

import { BID_THRESHOLDS, type getRecommendation } from './bidNoBidTypes';

type Recommendation = ReturnType<typeof getRecommendation>;

const RECOMMENDATION_TONE: Record<Recommendation['status'], StatusTone> = {
  success: 'success',
  warning: 'warning',
  danger: 'error',
};

export function ScoreInstrumentPanel({
  totalScore,
  savedScore,
  recommendation,
  ratedCount,
  ratedWeight,
  criteriaCount,
}: {
  totalScore: number;
  /** Last persisted composite for this opportunity, or null when nothing is saved. */
  savedScore: number | null;
  recommendation: Recommendation;
  ratedCount: number;
  ratedWeight: number;
  criteriaCount: number;
}) {
  const { t } = useTranslation('crm');

  const drift = savedScore == null ? 0 : totalScore - savedScore;
  const delta: StatDelta | undefined =
    drift === 0
      ? undefined
      : {
          value: `${drift > 0 ? '+' : ''}${drift}`,
          label: t('bidNoBid.panel.deltaVsSaved', 'vs saved'),
        };

  const rated = ratedCount > 0;

  return (
    <StatGroup className="mb-6 rounded-lg bg-surface-card">
      <StatCard
        // role + aria-label rather than a bare aria-label: a name on a generic
        // div is dropped by assistive tech. The phrasing is the one this page
        // has always exposed (it was ScoreSummaryStrip's ProgressRing label).
        role="group"
        aria-label={t('scoreSummaryStrip.overallBidScoreLabel', 'Overall bid score: {{score}}%', {
          score: totalScore,
        })}
        label={t('bidNoBid.panel.composite', 'Composite score')}
        value={totalScore}
        delta={delta}
        description={t(
          'bidNoBid.panel.compositeDescription',
          'Bid at {{bid}} and above, conditional from {{caution}}.',
          { bid: BID_THRESHOLDS.bid, caution: BID_THRESHOLDS.proceedWithCaution },
        )}
      />

      <StatCard
        label={t('bidNoBid.panel.recommendation', 'Recommendation')}
        value={
          <StatusIndicator
            tone={rated ? RECOMMENDATION_TONE[recommendation.status] : 'neutral'}
            // text-base, not the inherited 3xl: a verdict is a sentence, and a
            // sentence set at display size stops being readable at four-up.
            className="text-base font-medium text-fg-primary"
            label={
              rated
                ? recommendation.verdict
                : t('bidNoBid.panel.recommendationPending', 'Not yet rated')
            }
          />
        }
        description={t(
          'bidNoBid.panel.recommendationDescription',
          'A score below the threshold requires a logged override before it saves.',
        )}
      />

      <StatCard
        label={t('bidNoBid.panel.rated', 'Criteria rated')}
        value={`${ratedCount}/${criteriaCount}`}
        description={t(
          'bidNoBid.panel.ratedDescription',
          'Unrated criteria count as zero in the composite.',
        )}
      />

      <StatCard
        label={t('bidNoBid.panel.weightRated', 'Weight rated')}
        value={ratedWeight}
        description={t(
          'bidNoBid.panel.weightRatedDescription',
          'of {{total}} weighted points carry a rating.',
          { total: BID_TOTAL_WEIGHT },
        )}
      />
    </StatGroup>
  );
}
