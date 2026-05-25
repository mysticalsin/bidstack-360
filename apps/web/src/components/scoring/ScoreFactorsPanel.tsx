/**
 * ScoreFactorsPanel — embedded in lead/opportunity detail pages.
 *
 * Displays top 5 SHAP factors as a horizontal bar chart with:
 *   - Positive contributions (green bars, right of zero)
 *   - Negative contributions (red bars, left of zero)
 *   - Plain-English factor labels
 *   - Recommendation text from the model
 *
 * Accessibility:
 *   - Role="img" on the chart section with aria-label summary.
 *   - Data table available via aria-details for screen readers.
 *   - Bars have aria-valuenow.
 *   - prefers-reduced-motion: bars appear instantly, no transition.
 *
 * Dark mode: all colors via CSS variables + Tailwind dark: prefix.
 */

import { useLeadScore, useOppScore } from '@/hooks/usePredictiveScore';
import type { ScoreFactor } from '@/hooks/usePredictiveScore';

// ─── Types ────────────────────────────────────────────────────────────────

interface ScoreFactorsPanelProps {
  entityType: 'lead' | 'opportunity';
  entityId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function featureLabel(feature: string): string {
  const map: Record<string, string> = {
    log_value_micros: 'Deal Value',
    stage_probability: 'Pipeline Stage',
    days_in_current_stage: 'Days in Stage',
    total_age_days: 'Deal Age',
    days_to_expected_close: 'Days to Close',
    num_contacts_on_account: 'Contact Count',
    num_meetings_held: 'Meetings Held',
    num_emails_sent_received: 'Emails Exchanged',
    last_activity_days_ago: 'Last Activity',
    owner_close_rate_last_90d: 'Owner Win Rate (90d)',
    qualification_score_norm: 'Qualification Score',
    title_seniority: 'Contact Seniority',
    engagement_count_30d: 'Engagement (30d)',
    email_domain_age_bucket: 'Email Domain',
    company_size_bucket: 'Company Size',
    activity_recency_days: 'Activity Recency',
    bant_budget: 'Budget',
    bant_authority: 'Authority',
    bant_need: 'Need',
    bant_timeline: 'Timeline',
  };
  return (
    map[feature] ??
    feature.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// ─── Bar chart ────────────────────────────────────────────────────────────

function FactorBar({ factor, maxAbs }: { factor: ScoreFactor; maxAbs: number }) {
  const pct = maxAbs > 0 ? Math.abs(factor.contribution) / maxAbs : 0;
  const widthPct = Math.round(pct * 100);
  const positive = factor.contribution >= 0;

  return (
    <li className="flex items-center gap-3 text-sm py-1">
      {/* Label */}
      <span
        className="w-40 flex-shrink-0 text-right text-[var(--color-neutral-700)] dark:text-[var(--color-neutral-300)] truncate"
        title={featureLabel(factor.feature)}
      >
        {featureLabel(factor.feature)}
      </span>

      {/* Bidirectional bar */}
      <div className="flex-1 flex items-center h-5 relative" aria-hidden="true">
        {/* Center line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--color-border)] dark:bg-[var(--color-border-dark)]" />

        {/* Bar segment */}
        <div
          className={[
            'absolute top-1 bottom-1 rounded transition-all',
            positive
              ? 'left-1/2 bg-emerald-500 dark:bg-emerald-400'
              : 'right-1/2 bg-red-500 dark:bg-red-400',
            'motion-reduce:transition-none',
          ].join(' ')}
          style={{ width: `${widthPct / 2}%` }}
        />
      </div>

      {/* Value */}
      <span
        aria-valuenow={factor.contribution}
        aria-label={`Contribution: ${factor.contribution > 0 ? '+' : ''}${(factor.contribution * 100).toFixed(1)}`}
        className={[
          'w-12 text-right tabular-nums font-mono text-xs flex-shrink-0',
          positive
            ? 'text-emerald-700 dark:text-emerald-300'
            : 'text-red-700 dark:text-red-300',
        ].join(' ')}
      >
        {positive ? '+' : ''}{(factor.contribution * 100).toFixed(1)}
      </span>
    </li>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────

function PanelSkeleton() {
  return (
    <div className="animate-pulse space-y-3" aria-label="Loading score factors" aria-busy="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-4 w-36 bg-[var(--color-neutral-200)] dark:bg-[var(--color-neutral-700)] rounded" />
          <div className="flex-1 h-4 bg-[var(--color-neutral-200)] dark:bg-[var(--color-neutral-700)] rounded" />
          <div className="h-4 w-10 bg-[var(--color-neutral-200)] dark:bg-[var(--color-neutral-700)] rounded" />
        </div>
      ))}
    </div>
  );
}

// ─── Data table for screen readers ────────────────────────────────────────

function FactorTable({ factors }: { factors: ScoreFactor[] }) {
  return (
    <table className="sr-only" id="score-factors-table">
      <caption>Score contributing factors</caption>
      <thead>
        <tr>
          <th scope="col">Factor</th>
          <th scope="col">Contribution</th>
        </tr>
      </thead>
      <tbody>
        {factors.map((f) => (
          <tr key={f.feature}>
            <td>{featureLabel(f.feature)}</td>
            <td>
              {f.contribution > 0 ? '+' : ''}
              {(f.contribution * 100).toFixed(1)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────

function PanelContent({
  score,
  factors,
  recommendation,
  modelVersion,
  label,
}: {
  score: number;
  factors: ScoreFactor[];
  recommendation?: string;
  modelVersion: string;
  label: string;
}) {
  const top5 = factors.slice(0, 5);
  const maxAbs = top5.reduce((m, f) => Math.max(m, Math.abs(f.contribution)), 0.01);

  return (
    <section className="rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-[var(--color-surface)] dark:bg-[var(--color-surface-elevated)] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-[var(--color-neutral-900)] dark:text-[var(--color-neutral-100)]">
          ML Score Analysis
        </h3>
        <span className="text-xs text-[var(--color-neutral-500)]">{label}: {score}</span>
      </div>

      {/* Recommendation */}
      {recommendation && (
        <div className="mb-4 p-3 rounded-lg bg-[var(--color-neutral-50)] dark:bg-[var(--color-neutral-800)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
          <p className="text-sm text-[var(--color-neutral-700)] dark:text-[var(--color-neutral-300)] leading-relaxed">
            {recommendation}
          </p>
        </div>
      )}

      {/* Bar chart */}
      <div
        role="img"
        aria-label={`Top ${top5.length} factors influencing the ${label.toLowerCase()}`}
        aria-details="score-factors-table"
      >
        <ul className="space-y-0.5">
          {top5.map((f) => (
            <FactorBar key={f.feature} factor={f} maxAbs={maxAbs} />
          ))}
        </ul>
      </div>

      {/* Screen-reader accessible data table */}
      <FactorTable factors={top5} />

      {/* Footer */}
      <p className="mt-3 text-[10px] text-[var(--color-neutral-400)] text-right">
        Model v{modelVersion} · Logistic regression · Updated hourly
      </p>
    </section>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export function ScoreFactorsPanel({ entityType, entityId }: ScoreFactorsPanelProps) {
  const leadQuery = useLeadScore(entityType === 'lead' ? entityId : undefined);
  const oppQuery = useOppScore(entityType === 'opportunity' ? entityId : undefined);

  const isLoading = entityType === 'lead' ? leadQuery.isLoading : oppQuery.isLoading;
  const isError = entityType === 'lead' ? leadQuery.isError : oppQuery.isError;

  if (isLoading) return <PanelSkeleton />;
  if (isError) return null;

  if (entityType === 'lead' && leadQuery.data) {
    const { score, factors, modelVersion } = leadQuery.data;
    return (
      <PanelContent
        score={score}
        factors={factors}
        modelVersion={modelVersion}
        label="Lead Score"
      />
    );
  }

  if (entityType === 'opportunity' && oppQuery.data) {
    const { winProbability, factors, recommendation, modelVersion } = oppQuery.data;
    return (
      <PanelContent
        score={winProbability}
        factors={factors}
        recommendation={recommendation}
        modelVersion={modelVersion}
        label="Win Probability"
      />
    );
  }

  return null;
}
