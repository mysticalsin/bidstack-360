/**
 * LeadScoreBadge — colored score chip for lead cards/rows.
 *
 * WCAG 2.2 AA compliance:
 *   - Score displayed as text, NOT color alone (Rule: not color alone).
 *   - Badge includes aria-label with full description.
 *   - Color bands: risk (0-39) / watch (40-59) / healthy (60-100) — mapping
 *     and theme-token pairs live in scoreTone.ts (shared with the opp badge).
 *
 * Hover popover: shows top 3 SHAP factors with plain-English labels.
 * Keyboard accessible: popover triggers on focus.
 *
 * Loading state: pulse skeleton — never shows stale 0 as actual score.
 */

import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ScoreFactor } from '@/hooks/usePredictiveScore';
import { useLeadScore } from '@/hooks/usePredictiveScore';
import { SCORE_TONE_CLASSES, leadScoreTone } from '@/components/scoring/scoreTone';

// ─── Types ────────────────────────────────────────────────────────────────

interface LeadScoreBadgeProps {
  leadId: string;
  /** If score is already loaded by parent, pass it to avoid duplicate fetches. */
  prefetched?: { score: number; factors: ScoreFactor[] };
  size?: 'sm' | 'md';
}

function scoreLabel(score: number, t: TFunction): string {
  if (score >= 60) return t('leadScoreBadge.labelHot', 'Hot');
  if (score >= 40) return t('leadScoreBadge.labelWarm', 'Warm');
  return t('leadScoreBadge.labelCold', 'Cold');
}

function featureLabel(feature: string): string {
  // Human-readable label for feature names
  return feature
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace('Bant ', 'BANT ')
    .replace('Log Value Micros', 'Deal Value')
    .replace('Owner Close Rate Last 90d', 'Owner Win Rate');
}

// ─── Skeleton ─────────────────────────────────────────────────────────────

function ScoreSkeleton({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const { t } = useTranslation('crm');
  const h = size === 'sm' ? 'h-5 w-12' : 'h-6 w-16';
  return (
    <span
      className={`inline-block rounded-full animate-pulse bg-[var(--surface-sunken)] dark:bg-[var(--surface-hover)] ${h}`}
      aria-label={t('leadScoreBadge.loading', 'Loading score...')}
      aria-busy="true"
    />
  );
}

// ─── Factor list ──────────────────────────────────────────────────────────

function FactorList({ factors }: { factors: ScoreFactor[] }) {
  const top3 = factors.slice(0, 3);
  return (
    <ul className="space-y-1 text-xs">
      {top3.map((f) => (
        <li key={f.feature} className="flex items-center gap-2">
          <span
            className={[
              'inline-block h-2 w-2 rounded-full flex-shrink-0',
              f.contribution > 0 ? 'bg-[var(--success)]' : 'bg-[var(--danger)]',
            ].join(' ')}
            aria-hidden="true"
          />
          <span className="text-[var(--fg-secondary)]">{featureLabel(f.feature)}</span>
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
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export function LeadScoreBadge({ leadId, prefetched, size = 'md' }: LeadScoreBadgeProps) {
  const { data, isLoading, isError } = useLeadScore(prefetched ? undefined : leadId);
  const { t } = useTranslation('crm');
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const score = prefetched?.score ?? data?.score;
  const factors = prefetched?.factors ?? data?.factors ?? [];

  if (isLoading) return <ScoreSkeleton size={size} />;
  if (isError || score === undefined) return null;

  const colorClasses = SCORE_TONE_CLASSES[leadScoreTone(score)];
  const label = scoreLabel(score, t);
  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  return (
    <span className="relative inline-flex">
      {/* Badge button — triggers popover on click/focus */}
      <button
        ref={triggerRef}
        type="button"
        aria-label={t('leadScoreBadge.badgeAriaLabel', 'Lead score: {{score}} out of 100 — {{label}}', { score, label })}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          // Close unless focus moved into the popover
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) {
            setOpen(false);
          }
        }}
        className={[
          'inline-flex items-center gap-1 rounded-full font-semibold cursor-pointer',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
          'focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-[var(--surface-card)]',
          'min-w-[44px] min-h-[44px] justify-center',
          // Collapse to badge size visually but keep touch target
          'relative',
          padding,
          colorClasses,
        ].join(' ')}
      >
        {/* Aria-hidden span handles visual badge — parent button has full label */}
        <span aria-hidden="true">{score}</span>
        <span aria-hidden="true" className="hidden sm:inline opacity-70 font-normal">
          {label}
        </span>
      </button>

      {/* Popover — SHAP factor breakdown */}
      {open && factors.length > 0 && (
        <div
          aria-label={t('leadScoreBadge.popoverAriaLabel', 'Score factors')}
          className={[
            'absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50',
            'w-60 rounded-lg border p-3 shadow-lg',
            'bg-[var(--surface-raised)] border-[var(--border-default)]',
          ].join(' ')}
        >
          <p className="text-xs font-semibold text-[var(--fg-primary)] mb-2">
            {t('leadScoreBadge.popoverHeading', 'Top scoring factors')}
          </p>
          <FactorList factors={factors} />
          <p className="mt-2 text-[10px] text-[var(--fg-muted)]">
            {t('leadScoreBadge.popoverFooter', 'Score {{score}}/100 · ML model', { score })}
          </p>
        </div>
      )}
    </span>
  );
}
