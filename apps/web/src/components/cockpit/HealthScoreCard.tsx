import { motion, useReducedMotion } from 'framer-motion';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { springSoft } from '@/lib/motion';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

const ORDER = ['strong', 'good', 'needs_attention', 'critical'] as const;

interface Props {
  cockpit: AccountCockpitSnapshot;
}

export const HealthScoreCard = memo(function HealthScoreCard({ cockpit }: Props) {
  const { t } = useTranslation('crm');
  const reducedMotion = useReducedMotion();
  const total = ORDER.reduce((acc, key) => acc + (cockpit.health.counts[key] ?? 0), 0) || 1;
  const scorePct = Math.max(0, Math.min(100, cockpit.health.score)) / 100;
  const segments = ORDER.map((key) => ({
    key,
    count: cockpit.health.counts[key] ?? 0,
    pct: ((cockpit.health.counts[key] ?? 0) / total) * 100,
  }));
  const strongest = [...segments].sort((a, b) => b.count - a.count)[0] ?? segments[0];

  return (
    <Card
      role="region"
      aria-label={t('healthScore.regionLabel', 'Account signal coverage')}
      className="health-score-card"
    >
      <SectionHeader
        title={t('healthScore.title', 'Signal coverage')}
        caption={t('healthScore.signalsScored', '{{count}} account signals scored', { count: total })}
        action={
          <Badge tone={badgeTone(cockpit.health.band)}>
            {labelForHealth(cockpit.health.band, t)}
          </Badge>
        }
      />
      <div className="health-card-body">
        <motion.div
          className="health-stage"
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={springSoft}
          aria-label={t('healthScore.gaugeLabel', 'Account signal coverage {{score}} out of 100', {
            score: cockpit.health.score,
          })}
          role="img"
        >
          <svg className="health-gauge" viewBox="0 0 180 180" aria-hidden>
            <defs>
              <linearGradient id="health-gauge-gradient" x1="20" x2="160" y1="160" y2="20">
                <stop offset="0%" stopColor="var(--danger)" />
                <stop offset="42%" stopColor="var(--warning)" />
                <stop offset="100%" stopColor="var(--success)" />
              </linearGradient>
            </defs>
            <circle className="health-gauge-track" cx="90" cy="90" r="72" pathLength="1" />
            <motion.circle
              className="health-gauge-progress"
              cx="90"
              cy="90"
              r="72"
              pathLength="1"
              initial={{ strokeDashoffset: 1 }}
              animate={{ strokeDashoffset: 1 - scorePct }}
              transition={
                reducedMotion ? { duration: 0 } : { duration: 1.05, ease: [0.2, 0.8, 0.2, 1] }
              }
            />
          </svg>
          <div className="health-core">
            <span>{t('healthScore.coverage', 'Coverage')}</span>
            <strong>
              <AnimatedMetric value={cockpit.health.score.toLocaleString()} />
            </strong>
            <small>/100</small>
          </div>
          <div className="health-pulse" aria-hidden />
        </motion.div>
        <div className="health-summary">
          <div className="health-summary-head">
            <span>{t('healthScore.strongestBand', 'Strongest coverage band')}</span>
            <strong>
              {strongest ? labelForHealth(strongest.key, t) : t('healthScore.noSignal', 'No signal')}
            </strong>
          </div>
          <ul className="health-legend" aria-label={t('healthScore.healthBands', 'Health bands')}>
            {segments.map((segment, index) => (
              <motion.li
                key={segment.key}
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 }}
              >
                <span className={`legend-dot ${segment.key}`} aria-hidden />
                <span>{labelForHealth(segment.key, t)}</span>
                <span className="health-band-track" aria-hidden>
                  <motion.span
                    className={`health-band-fill ${segment.key}`}
                    initial={{ width: reducedMotion ? `${segment.pct}%` : '0%' }}
                    animate={{ width: `${segment.pct}%` }}
                    transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.05 }}
                  />
                </span>
                <strong>
                  <AnimatedMetric value={segment.count.toLocaleString()} />
                </strong>
              </motion.li>
            ))}
          </ul>
        </div>
      </div>
      <SignalFactorPanel factors={cockpit.health.factors ?? []} />
    </Card>
  );
});

/**
 * Explainability panel (M2): the 0-100 score is useless without context, so
 * each contributing factor states what it measures and the action to take.
 */
function SignalFactorPanel({
  factors,
}: {
  factors: NonNullable<AccountCockpitSnapshot['health']['factors']>;
}) {
  const { t } = useTranslation('crm');
  const [open, setOpen] = useState(false);
  if (factors.length === 0) return null;
  return (
    <div className="border-t border-[var(--border)] px-5 pb-4">
      <button
        type="button"
        className="flex min-h-[44px] w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wider text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{t('healthScore.whatDrivesScore', 'What drives this score')}</span>
        <span aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open ? (
        <ul className="space-y-3" aria-label={t('healthScore.scoreFactors', 'Score factors')}>
          {factors.map((f) => (
            <li key={f.key} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-[var(--fg-primary)]">{f.label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs tabular-nums text-[var(--fg-tertiary)]">
                    {f.score}/100
                  </span>
                  <Badge tone={badgeTone(f.band)}>{labelForHealth(f.band, t)}</Badge>
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">{f.whatItMeasures}</p>
              <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">
                <span className="font-medium">{t('healthScore.nextLabel', 'Next: ')}</span>
                {f.recommendedAction}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function labelForHealth(key: (typeof ORDER)[number], t: TFunction): string {
  if (key === 'strong') return t('healthScore.band.strong', 'Strong');
  if (key === 'good') return t('healthScore.band.good', 'Good');
  if (key === 'needs_attention') return t('healthScore.band.needsAttention', 'Needs attention');
  return t('healthScore.band.critical', 'Critical');
}

function badgeTone(key: (typeof ORDER)[number]) {
  if (key === 'strong') return 'jade';
  if (key === 'good') return 'blue';
  if (key === 'needs_attention') return 'amber';
  return 'tomato';
}
