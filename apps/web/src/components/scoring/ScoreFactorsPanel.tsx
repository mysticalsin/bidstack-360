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
 * Dark mode: theme tokens only (--fg-*, --surface-*, --border-*, --success,
 * --danger) — every color resolves in both themes from index.css.
 */

import { useTranslation } from 'react-i18next';
import { useLeadScore, useOppScore } from '@/hooks/usePredictiveScore';
import type { ScoreFactor } from '@/hooks/usePredictiveScore';

type TFunc = ReturnType<typeof useTranslation>['t'];

// ─── Types ────────────────────────────────────────────────────────────────

interface ScoreFactorsPanelProps {
  entityType: 'lead' | 'opportunity';
  entityId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function featureLabel(feature: string, t: TFunc): string {
  const map: Record<string, string> = {
    log_value_micros: t('scoreFactors.featureLabel.dealValue', 'Deal Value'),
    stage_probability: t('scoreFactors.featureLabel.pipelineStage', 'Pipeline Stage'),
    days_in_current_stage: t('scoreFactors.featureLabel.daysInStage', 'Days in Stage'),
    total_age_days: t('scoreFactors.featureLabel.dealAge', 'Deal Age'),
    days_to_expected_close: t('scoreFactors.featureLabel.daysToClose', 'Days to Close'),
    num_contacts_on_account: t('scoreFactors.featureLabel.contactCount', 'Contact Count'),
    num_meetings_held: t('scoreFactors.featureLabel.meetingsHeld', 'Meetings Held'),
    num_emails_sent_received: t('scoreFactors.featureLabel.emailsExchanged', 'Emails Exchanged'),
    last_activity_days_ago: t('scoreFactors.featureLabel.lastActivity', 'Last Activity'),
    owner_close_rate_last_90d: t('scoreFactors.featureLabel.ownerWinRate90d', 'Owner Win Rate (90d)'),
    qualification_score_norm: t('scoreFactors.featureLabel.qualificationScore', 'Qualification Score'),
    title_seniority: t('scoreFactors.featureLabel.contactSeniority', 'Contact Seniority'),
    engagement_count_30d: t('scoreFactors.featureLabel.engagement30d', 'Engagement (30d)'),
    email_domain_age_bucket: t('scoreFactors.featureLabel.emailDomain', 'Email Domain'),
    company_size_bucket: t('scoreFactors.featureLabel.companySize', 'Company Size'),
    activity_recency_days: t('scoreFactors.featureLabel.activityRecency', 'Activity Recency'),
    bant_budget: t('scoreFactors.featureLabel.budget', 'Budget'),
    bant_authority: t('scoreFactors.featureLabel.authority', 'Authority'),
    bant_need: t('scoreFactors.featureLabel.need', 'Need'),
    bant_timeline: t('scoreFactors.featureLabel.timeline', 'Timeline'),
  };
  return (
    map[feature] ??
    feature.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// ─── Bar chart ────────────────────────────────────────────────────────────

function FactorBar({ factor, maxAbs }: { factor: ScoreFactor; maxAbs: number }) {
  const { t } = useTranslation('crm');
  const pct = maxAbs > 0 ? Math.abs(factor.contribution) / maxAbs : 0;
  const widthPct = Math.round(pct * 100);
  const positive = factor.contribution >= 0;

  return (
    <li className="flex items-center gap-3 text-sm py-1">
      {/* Label */}
      <span
        className="w-40 flex-shrink-0 text-right text-[var(--fg-secondary)] truncate"
        title={featureLabel(factor.feature, t)}
      >
        {featureLabel(factor.feature, t)}
      </span>

      {/* Bidirectional bar */}
      <div className="flex-1 flex items-center h-5 relative" aria-hidden="true">
        {/* Center line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--border-default)]" />

        {/* Bar segment */}
        <div
          className={[
            'absolute top-1 bottom-1 rounded transition-all',
            positive ? 'left-1/2 bg-[var(--success)]' : 'right-1/2 bg-[var(--danger)]',
            'motion-reduce:transition-none',
          ].join(' ')}
          style={{ width: `${widthPct / 2}%` }}
        />
      </div>

      {/* Value */}
      <span
        aria-valuenow={factor.contribution}
        aria-label={t('scoreFactors.contributionAria', 'Contribution: {{value}}', {
          value: `${factor.contribution > 0 ? '+' : ''}${(factor.contribution * 100).toFixed(1)}`,
        })}
        className={[
          'w-12 text-right tabular-nums font-mono text-xs flex-shrink-0',
          positive ? 'text-[var(--success-fg)]' : 'text-[var(--fg-error)]',
        ].join(' ')}
      >
        {positive ? '+' : ''}{(factor.contribution * 100).toFixed(1)}
      </span>
    </li>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────

function PanelSkeleton() {
  const { t } = useTranslation('crm');
  return (
    <div
      className="animate-pulse space-y-3"
      aria-label={t('scoreFactors.loadingAria', 'Loading score factors')}
      aria-busy="true"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-4 w-36 bg-[var(--surface-sunken)] dark:bg-[var(--surface-hover)] rounded" />
          <div className="flex-1 h-4 bg-[var(--surface-sunken)] dark:bg-[var(--surface-hover)] rounded" />
          <div className="h-4 w-10 bg-[var(--surface-sunken)] dark:bg-[var(--surface-hover)] rounded" />
        </div>
      ))}
    </div>
  );
}

// ─── Data table for screen readers ────────────────────────────────────────

function FactorTable({ factors }: { factors: ScoreFactor[] }) {
  const { t } = useTranslation('crm');
  return (
    <table className="sr-only" id="score-factors-table">
      <caption>{t('scoreFactors.tableCaption', 'Score contributing factors')}</caption>
      <thead>
        <tr>
          <th scope="col">{t('scoreFactors.tableHeaderFactor', 'Factor')}</th>
          <th scope="col">{t('scoreFactors.tableHeaderContribution', 'Contribution')}</th>
        </tr>
      </thead>
      <tbody>
        {factors.map((f) => (
          <tr key={f.feature}>
            <td>{featureLabel(f.feature, t)}</td>
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
  const { t } = useTranslation('crm');
  const top5 = factors.slice(0, 5);
  const maxAbs = top5.reduce((m, f) => Math.max(m, Math.abs(f.contribution)), 0.01);

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-[var(--fg-primary)]">
          {t('scoreFactors.title', 'ML Score Analysis')}
        </h3>
        <span className="text-xs text-[var(--fg-muted)]">{label}: {score}</span>
      </div>

      {/* Recommendation */}
      {recommendation && (
        <div className="mb-4 p-3 rounded-lg bg-[var(--surface-soft)] border border-[var(--border-subtle)]">
          <p className="text-sm text-[var(--fg-secondary)] leading-relaxed">
            {recommendation}
          </p>
        </div>
      )}

      {/* Bar chart */}
      <div
        role="img"
        aria-label={t('scoreFactors.chartAria', 'Top {{count}} factors influencing the {{label}}', {
          count: top5.length,
          label: label.toLowerCase(),
        })}
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
      <p className="mt-3 text-[10px] text-[var(--fg-muted)] text-right">
        {t('scoreFactors.footer', 'Model v{{modelVersion}} · Logistic regression · Updated hourly', {
          modelVersion,
        })}
      </p>
    </section>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export function ScoreFactorsPanel({ entityType, entityId }: ScoreFactorsPanelProps) {
  const { t } = useTranslation('crm');
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
        label={t('scoreFactors.labelLeadScore', 'Lead Score')}
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
        label={t('scoreFactors.labelWinProbability', 'Win Probability')}
      />
    );
  }

  return null;
}
