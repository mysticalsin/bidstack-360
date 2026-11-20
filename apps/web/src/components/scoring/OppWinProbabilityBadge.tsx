/**
 * OppWinProbabilityBadge — win probability chip on opportunity cards.
 *
 * WCAG 2.2 AA:
 *   - Percentage shown as text, not color alone.
 *   - aria-label provides full context.
 *   - Touch target min 44×44px.
 *   - Dark mode via CSS variables.
 *
 * Color bands: risk (<40%) / watch (40-69%) / healthy (≥70%) — mapping and
 * theme-token pairs live in scoreTone.ts (shared with LeadScoreBadge).
 */

import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ScoreFactor } from '@/hooks/usePredictiveScore';
import { useOppScore } from '@/hooks/usePredictiveScore';
import { SCORE_TONE_CLASSES, oppWinProbabilityTone } from '@/components/scoring/scoreTone';

// ─── Types ────────────────────────────────────────────────────────────────

interface OppWinProbabilityBadgeProps {
  oppId: string;
  prefetched?: { winProbability: number; factors: ScoreFactor[] };
  size?: 'sm' | 'md';
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function probLabel(prob: number, t: TFunction): string {
  if (prob >= 70) return t('oppWinProbabilityBadge.labelLikely', 'Likely');
  if (prob >= 40) return t('oppWinProbabilityBadge.labelPossible', 'Possible');
  return t('oppWinProbabilityBadge.labelAtRisk', 'At risk');
}

function featureLabel(feature: string, t: TFunction): string {
  return feature
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace('Log Value Micros', t('oppWinProbabilityBadge.featureDealValue', 'Deal Value'))
    .replace(
      'Owner Close Rate Last 90d',
      t('oppWinProbabilityBadge.featureOwnerWinRate', 'Owner Win Rate')
    )
    .replace('Stage Probability', t('oppWinProbabilityBadge.featurePipelineStage', 'Pipeline Stage'))
    .replace(
      'Qualification Score Norm',
      t('oppWinProbabilityBadge.featureQualificationScore', 'Qualification Score')
    );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────

function ProbSkeleton({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const { t } = useTranslation('crm');
  const h = size === 'sm' ? 'h-5 w-14' : 'h-6 w-18';
  return (
    <span
      className={`inline-block rounded-full animate-pulse bg-[var(--surface-sunken)] dark:bg-[var(--surface-hover)] ${h}`}
      aria-label={t('oppWinProbabilityBadge.loading', 'Loading probability...')}
      aria-busy="true"
    />
  );
}

// ─── Popover ─────────────────────────────────────────────────────────────

function FactorPopover({
  factors,
  recommendation,
  prob,
}: {
  factors: ScoreFactor[];
  recommendation: string;
  prob: number;
}) {
  const { t } = useTranslation('crm');
  const top3 = factors.slice(0, 3);
  return (
    <div
      aria-label={t('oppWinProbabilityBadge.factorsAriaLabel', 'Win probability factors')}
      className={[
        'absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50',
        'w-64 rounded-lg border p-3 shadow-lg',
        'bg-[var(--surface-raised)] border-[var(--border-default)]',
      ].join(' ')}
    >
      <p className="text-xs font-semibold text-[var(--fg-primary)] mb-1">
        {t('oppWinProbabilityBadge.popoverTitle', 'Win probability: {{prob}}%', { prob })}
      </p>
      {recommendation && (
        <p className="text-xs text-[var(--fg-secondary)] mb-2 leading-relaxed">
          {recommendation}
        </p>
      )}
      {top3.length > 0 && (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-muted)] mb-1">
            {t('oppWinProbabilityBadge.keyFactors', 'Key factors')}
          </p>
          <ul className="space-y-1">
            {top3.map((f) => (
              <li key={f.feature} className="flex items-center gap-2 text-xs">
                <span
                  className={[
                    'inline-block h-2 w-2 rounded-full flex-shrink-0',
                    f.contribution > 0 ? 'bg-[var(--success)]' : 'bg-[var(--danger)]',
                  ].join(' ')}
                  aria-hidden="true"
                />
                <span className="text-[var(--fg-secondary)] flex-1">
                  {featureLabel(f.feature, t)}
                </span>
                <span
                  className={[
                    'ml-auto font-mono tabular-nums',
                    f.contribution > 0 ? 'text-[var(--success-fg)]' : 'text-[var(--fg-error)]',
                  ].join(' ')}
                >
                  {f.contribution > 0 ? '+' : ''}
                  {(f.contribution * 100).toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export function OppWinProbabilityBadge({
  oppId,
  prefetched,
  size = 'md',
}: OppWinProbabilityBadgeProps) {
  const { t } = useTranslation('crm');
  const { data, isLoading, isError } = useOppScore(prefetched ? undefined : oppId);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const prob = prefetched?.winProbability ?? data?.winProbability;
  const factors = prefetched?.factors ?? data?.factors ?? [];
  const recommendation = data?.recommendation ?? '';

  if (isLoading) return <ProbSkeleton size={size} />;
  if (isError || prob === undefined) return null;

  const colorClasses = SCORE_TONE_CLASSES[oppWinProbabilityTone(prob)];
  const label = probLabel(prob, t);
  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-label={t('oppWinProbabilityBadge.badgeAriaLabel', 'Win probability: {{prob}}% — {{label}}', {
          prob,
          label,
        })}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) {
            setOpen(false);
          }
        }}
        className={[
          'inline-flex items-center gap-1 rounded-full font-semibold cursor-pointer',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
          'focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-[var(--surface-card)]',
          'min-w-[44px] min-h-[44px] justify-center',
          padding,
          colorClasses,
        ].join(' ')}
      >
        <span aria-hidden="true">{prob}%</span>
        <span aria-hidden="true" className="hidden sm:inline opacity-70 font-normal">
          {label}
        </span>
      </button>

      {open && <FactorPopover factors={factors} recommendation={recommendation} prob={prob} />}
    </span>
  );
}
