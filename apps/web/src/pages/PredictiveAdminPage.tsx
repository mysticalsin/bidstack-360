/**
 * PredictiveAdminPage — Settings → Predictive Scoring.
 *
 * Shows per-entity-type model status: accuracy metrics, last train time,
 * sample count, model history, and "Retrain Now" button.
 *
 * Admin-only: rendered behind the admin permission gate in the router.
 *
 * WCAG 2.2 AA:
 *   - Table has caption + th scope.
 *   - Buttons have descriptive aria-label.
 *   - Metric badges include text (not color alone).
 *   - Dark mode via CSS variables.
 *   - Reduced motion: no spinner animation.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  usePredictiveModels,
  useRetrainModel,
} from '@/hooks/usePredictiveScore';

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function MetricPill({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  // Semantic tint tokens — contrast-verified in both themes in index.css.
  const colorClass =
    pct >= 70
      ? 'bg-[var(--success-tint)] text-[var(--success-fg)]'
      : pct >= 50
      ? 'bg-[var(--warning-tint)] text-[var(--warning-fg)]'
      : 'bg-[var(--error-surface)] text-[var(--fg-error)]';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${colorClass}`}
      aria-label={`${label}: ${pct}%`}
    >
      {label} {pct}%
    </span>
  );
}

// ─── Model table ──────────────────────────────────────────────────────────

function ModelTable({ filter }: { filter: 'lead' | 'opportunity' }) {
  const { t } = useTranslation('crm');
  const { data, isLoading } = usePredictiveModels(filter);
  const models = data?.items ?? [];

  if (isLoading) {
    return (
      // Shimmer rows shaped like the model history table — shared bs-shimmer
      // system instead of a single generic pulse block.
      <div
        className="space-y-3 py-2"
        aria-busy="true"
        aria-live="polite"
        aria-label={t('predictiveAdmin.modelTableLoadingLabel', 'Loading models...')}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4" aria-hidden>
            <span className="bs-shimmer h-4 w-16" />
            <span className="bs-shimmer h-4 flex-1" />
            <span className="bs-shimmer h-4 w-12" />
            <span className="bs-shimmer h-4 w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <p className="text-sm text-[var(--fg-secondary)] py-4">
        {t(
          'predictiveAdmin.modelTableEmpty',
          'No {{entityType}} models trained yet. Click "Retrain Now" to train the first model.',
          { entityType: filter },
        )}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <caption className="sr-only">
          {t('predictiveAdmin.modelTableCaption', '{{entityType}} predictive model history', {
            entityType: filter,
          })}
        </caption>
        <thead>
          <tr className="border-b border-[var(--border-subtle)]">
            <th scope="col" className="py-2 pr-4 text-left text-xs font-semibold text-[var(--fg-tertiary)] uppercase tracking-wide">
              {t('predictiveAdmin.colVersion', 'Version')}
            </th>
            <th scope="col" className="py-2 pr-4 text-left text-xs font-semibold text-[var(--fg-tertiary)] uppercase tracking-wide">
              {t('predictiveAdmin.colAccuracyMetrics', 'Accuracy Metrics')}
            </th>
            <th scope="col" className="py-2 pr-4 text-right text-xs font-semibold text-[var(--fg-tertiary)] uppercase tracking-wide">
              {t('predictiveAdmin.colSamples', 'Samples')}
            </th>
            <th scope="col" className="py-2 pr-4 text-left text-xs font-semibold text-[var(--fg-tertiary)] uppercase tracking-wide">
              {t('predictiveAdmin.colTrained', 'Trained')}
            </th>
            <th scope="col" className="py-2 text-center text-xs font-semibold text-[var(--fg-tertiary)] uppercase tracking-wide">
              {t('predictiveAdmin.colActive', 'Active')}
            </th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr
              key={m.id}
              className={[
                'border-b border-[var(--border-subtle)]',
                m.isActive ? 'bg-[var(--brand-primary-tint)]' : '',
              ].join(' ')}
            >
              <td className="py-3 pr-4 font-mono text-[var(--fg-secondary)]">
                v{m.version}
              </td>
              <td className="py-3 pr-4">
                <div className="flex flex-wrap gap-1">
                  <MetricPill label={t('predictiveAdmin.metricAuc', 'AUC')} value={m.accuracyMetrics.auc} />
                  <MetricPill label={t('predictiveAdmin.metricF1', 'F1')} value={m.accuracyMetrics.f1} />
                  <MetricPill label={t('predictiveAdmin.metricPrecision', 'Prec')} value={m.accuracyMetrics.precision} />
                  <MetricPill label={t('predictiveAdmin.metricRecall', 'Rec')} value={m.accuracyMetrics.recall} />
                </div>
              </td>
              <td className="py-3 pr-4 text-right tabular-nums text-[var(--fg-secondary)]">
                {m.sampleCount.toLocaleString()}
              </td>
              <td className="py-3 pr-4 text-[var(--fg-secondary)]">
                {formatDateTime(m.trainedAt)}
              </td>
              <td className="py-3 text-center">
                {/* Presence tokens: status-dot colors with verified 3:1 UI contrast */}
                {m.isActive ? (
                  <span
                    className="inline-block w-2 h-2 rounded-full bg-[var(--presence-online)]"
                    aria-label={t('predictiveAdmin.activeModelLabel', 'Active model')}
                  />
                ) : (
                  <span
                    className="inline-block w-2 h-2 rounded-full bg-[var(--presence-offline)]"
                    aria-label={t('predictiveAdmin.inactiveModelLabel', 'Inactive')}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Entity section ────────────────────────────────────────────────────────

function EntitySection({ entityType }: { entityType: 'lead' | 'opportunity' }) {
  const { t } = useTranslation('crm');
  const retrain = useRetrainModel();
  const [success, setSuccess] = useState<string | null>(null);

  const handleRetrain = async () => {
    setSuccess(null);
    try {
      const res = await retrain.mutateAsync({ entityType });
      setSuccess(res.message);
    } catch {
      // error surfaced via retrain.isError
    }
  };

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6">
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold text-[var(--fg-primary)] capitalize">
            {t('predictiveAdmin.sectionHeading', '{{entityType}} Scoring Model', { entityType })}
          </h2>
          <p className="text-xs text-[var(--fg-tertiary)] mt-0.5">
            {t('predictiveAdmin.sectionSubtitle', 'Logistic regression · per-org · retrained weekly')}
          </p>
        </div>

        <button
          type="button"
          aria-label={t('predictiveAdmin.retrainButtonLabel', 'Retrain {{entityType}} model now', {
            entityType,
          })}
          onClick={handleRetrain}
          disabled={retrain.isPending}
          className={[
            'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium',
            'min-h-[44px] min-w-[44px]',
            // --color-primary-* never existed in this design system — the CTA
            // rendered as white-on-transparent. Brand tokens resolve in both themes.
            'bg-[var(--brand-primary)] text-[var(--fg-on-brand)]',
            'hover:bg-[var(--brand-primary-hover)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-1',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-colors motion-reduce:transition-none',
          ].join(' ')}
        >
          {retrain.isPending ? (
            <>
              <span
                className="inline-block h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              {t('predictiveAdmin.retrainPending', 'Queuing…')}
            </>
          ) : (
            t('predictiveAdmin.retrainButton', 'Retrain Now')
          )}
        </button>
      </div>

      {/* Status messages */}
      {success && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 px-3 py-2 rounded-lg bg-[var(--success-surface)] text-[var(--success-fg)] text-sm"
        >
          {success}
        </div>
      )}
      {retrain.isError && (
        <div
          role="alert"
          className="mb-4 px-3 py-2 rounded-lg bg-[var(--error-surface)] text-[var(--fg-error)] text-sm"
        >
          {t('predictiveAdmin.retrainError', 'Retrain failed. Please try again.')}
        </div>
      )}

      <ModelTable filter={entityType} />
    </section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function PredictiveAdminPage() {
  const { t } = useTranslation('crm');
  return (
    <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)]">
          {t('predictiveAdmin.pageTitle', 'Predictive Scoring')}
        </h1>
        <p className="text-sm text-[var(--fg-secondary)] mt-1">
          {t(
            'predictiveAdmin.pageSubtitle',
            "ML-based lead and opportunity scoring — trained on your org's closed deal history. Models are automatically retrained every Sunday at 02:00 UTC.",
          )}
        </p>
      </div>

      {/* Info banner */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4">
        <p className="text-sm text-[var(--fg-secondary)]">
          <strong>{t('predictiveAdmin.dataPrivacyLabel', 'Data privacy:')}</strong>{' '}
          {t(
            'predictiveAdmin.dataPrivacyBody',
            'Model artifacts contain only learned weights — no raw deal data, names, or emails. Each org trains its own isolated model. Scores are cached for 1 hour in Redis and invalidated on record updates.',
          )}
        </p>
      </div>

      {/* Entity sections */}
      <EntitySection entityType="lead" />
      <EntitySection entityType="opportunity" />
    </main>
  );
}
