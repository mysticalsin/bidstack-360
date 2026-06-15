// Score summary strip — overall ProgressRing + per-category rings.
import { useTranslation } from 'react-i18next';

import { GlassCard } from '@/components/ui/GlassCard';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { StatusPulse } from '@/components/ui/StatusPulse';
import { Reveal } from '@/components/motion/Reveal';

import { CATEGORY_INFO, CRITERIA } from './bidNoBidTypes';

export function ScoreSummaryStrip({
  totalScore,
  recommendation,
  categoryScores,
  ratedCount,
}: {
  totalScore: number;
  recommendation: { verdict: string; color: string; status: 'success' | 'warning' | 'danger' };
  categoryScores: Record<string, number>;
  ratedCount: number;
}) {
  const { t } = useTranslation('crm');
  return (
    <Reveal>
      <GlassCard className="mt-4 mb-6">
        <div className="flex flex-wrap items-center gap-8 p-5">
          <div className="flex items-center gap-4">
            <ProgressRing
              value={totalScore}
              size={80}
              strokeWidth={6}
              colors={[recommendation.color, recommendation.color]}
              label={t('scoreSummaryStrip.overallBidScoreLabel', 'Overall bid score: {{score}}%', {
                score: totalScore,
              })}
            >
              <span className="text-xl font-bold" style={{ color: recommendation.color }}>
                {totalScore}
              </span>
            </ProgressRing>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <StatusPulse
                  status={recommendation.status}
                  label={recommendation.verdict}
                  animate={ratedCount > 0}
                />
                <span className="text-sm font-semibold" style={{ color: recommendation.color }}>
                  {ratedCount > 0
                    ? recommendation.verdict
                    : t('scoreSummaryStrip.rateCriteriaToBegin', 'Rate criteria to begin')}
                </span>
              </div>
              <p className="text-tertiary text-xs">
                {t('scoreSummaryStrip.weightedScoreSummary', 'Weighted score across {{count}} decision factors', {
                  count: CRITERIA.length,
                })}
              </p>
            </div>
          </div>

          <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4 min-w-0">
            {Object.entries(CATEGORY_INFO).map(([cat, info]) => {
              const catScore = categoryScores[cat] ?? 0;
              return (
                <div key={cat} className="flex items-center gap-3">
                  <ProgressRing
                    value={catScore}
                    size={40}
                    strokeWidth={3}
                    colors={[info.color, info.color]}
                  >
                    <span className="text-[10px] font-bold text-fg-secondary">{catScore}</span>
                  </ProgressRing>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-fg-primary truncate">{info.label}</p>
                    <p className="text-[10px] text-fg-tertiary">
                      {catScore > 0 ? `${catScore}%` : '—'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </GlassCard>
    </Reveal>
  );
}
