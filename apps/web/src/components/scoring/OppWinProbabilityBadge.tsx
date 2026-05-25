/**
 * OppWinProbabilityBadge — win probability chip on opportunity cards.
 *
 * WCAG 2.2 AA:
 *   - Percentage shown as text, not color alone.
 *   - aria-label provides full context.
 *   - Touch target min 44×44px.
 *   - Dark mode via CSS variables.
 *
 * Color bands:
 *   ≥70%  → green  (4.6:1 contrast)
 *   40-69% → amber (4.7:1)
 *   <40%  → red    (5.1:1)
 */

import { useState, useRef } from 'react';
import type { ScoreFactor } from '@/hooks/usePredictiveScore';
import { useOppScore } from '@/hooks/usePredictiveScore';

// ─── Types ────────────────────────────────────────────────────────────────

interface OppWinProbabilityBadgeProps {
  oppId: string;
  prefetched?: { winProbability: number; factors: ScoreFactor[] };
  size?: 'sm' | 'md';
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function probColorClasses(prob: number): string {
  if (prob >= 70) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300';
  if (prob >= 40) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
}

function probLabel(prob: number): string {
  if (prob >= 70) return 'Likely';
  if (prob >= 40) return 'Possible';
  return 'At risk';
}

function featureLabel(feature: string): string {
  return feature
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace('Log Value Micros', 'Deal Value')
    .replace('Owner Close Rate Last 90d', 'Owner Win Rate')
    .replace('Stage Probability', 'Pipeline Stage')
    .replace('Qualification Score Norm', 'Qualification Score');
}

// ─── Skeleton ─────────────────────────────────────────────────────────────

function ProbSkeleton({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const h = size === 'sm' ? 'h-5 w-14' : 'h-6 w-18';
  return (
    <span
      className={`inline-block rounded-full animate-pulse bg-[var(--color-neutral-200)] dark:bg-[var(--color-neutral-700)] ${h}`}
      aria-label="Loading probability..."
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
  const top3 = factors.slice(0, 3);
  return (
    <div
      role="dialog"
      aria-label="Win probability factors"
      className={[
        'absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50',
        'w-64 rounded-lg border p-3 shadow-lg',
        'bg-[var(--color-surface)] border-[var(--color-border)]',
        'dark:bg-[var(--color-surface-elevated)] dark:border-[var(--color-border-dark)]',
      ].join(' ')}
    >
      <p className="text-xs font-semibold text-[var(--color-neutral-900)] dark:text-[var(--color-neutral-100)] mb-1">
        Win probability: {prob}%
      </p>
      {recommendation && (
        <p className="text-xs text-[var(--color-neutral-600)] dark:text-[var(--color-neutral-400)] mb-2 leading-relaxed">
          {recommendation}
        </p>
      )}
      {top3.length > 0 && (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-neutral-500)] mb-1">
            Key factors
          </p>
          <ul className="space-y-1">
            {top3.map((f) => (
              <li key={f.feature} className="flex items-center gap-2 text-xs">
                <span
                  className={[
                    'inline-block h-2 w-2 rounded-full flex-shrink-0',
                    f.contribution > 0
                      ? 'bg-emerald-500 dark:bg-emerald-400'
                      : 'bg-red-500 dark:bg-red-400',
                  ].join(' ')}
                  aria-hidden="true"
                />
                <span className="text-[var(--color-neutral-700)] dark:text-[var(--color-neutral-300)] flex-1">
                  {featureLabel(f.feature)}
                </span>
                <span
                  className={[
                    'ml-auto font-mono tabular-nums',
                    f.contribution > 0
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-red-700 dark:text-red-300',
                  ].join(' ')}
                >
                  {f.contribution > 0 ? '+' : ''}{(f.contribution * 100).toFixed(1)}
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
  const { data, isLoading, isError } = useOppScore(prefetched ? undefined : oppId);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const prob = prefetched?.winProbability ?? data?.winProbability;
  const factors = prefetched?.factors ?? data?.factors ?? [];
  const recommendation = data?.recommendation ?? '';

  if (isLoading) return <ProbSkeleton size={size} />;
  if (isError || prob === undefined) return null;

  const colorClasses = probColorClasses(prob);
  const label = probLabel(prob);
  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Win probability: ${prob}% — ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
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
          'focus-visible:ring-[var(--color-primary-500)]',
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

      {open && (
        <FactorPopover factors={factors} recommendation={recommendation} prob={prob} />
      )}
    </span>
  );
}
