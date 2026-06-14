/**
 * CallSummaryPanel — AI-generated summary, action items, MEDDIC signals,
 * and suggested deal updates for a completed call.
 *
 * WHY: aggregates every insight surface in one read-only panel; deal update
 * suggestions are displayed as notifications only — never auto-applied
 * (HUMAN-IN-THE-LOOP requirement from the Wave 8 spec).
 *
 * MEDDIC keys stored in CallSummary.key follow the pattern:
 *   MEDDIC_METRIC, MEDDIC_ECONOMIC_BUYER, MEDDIC_DECISION_CRITERIA,
 *   MEDDIC_DECISION_PROCESS, MEDDIC_IDENTIFY_PAIN, MEDDIC_CHAMPION
 *   SENTIMENT_SCORE, TALK_RATIO, ACTION_ITEM, DEAL_SUGGESTION
 *
 * WCAG 2.2 AA: table with proper th/td, aria-labels, focus rings.
 * Dark mode via CSS variables.
 */

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useCall, useExtractInsights, type CallSummaryEntry } from '@/hooks/useCalls';
import type { BadgeTone } from '@/components/ui/Badge';

// ─── MEDDIC dimension display names ───────────────────────────────────────────

const MEDDIC_LABELS: Record<string, string> = {
  MEDDIC_METRIC: 'Metrics',
  MEDDIC_ECONOMIC_BUYER: 'Economic Buyer',
  MEDDIC_DECISION_CRITERIA: 'Decision Criteria',
  MEDDIC_DECISION_PROCESS: 'Decision Process',
  MEDDIC_IDENTIFY_PAIN: 'Identified Pain',
  MEDDIC_CHAMPION: 'Champion',
};

// ─── Confidence badge ─────────────────────────────────────────────────────────

function confidenceTone(confidence: number): BadgeTone {
  if (confidence >= 0.8) return 'jade';
  if (confidence >= 0.5) return 'amber';
  return 'tomato';
}

// ─── MEDDIC table ─────────────────────────────────────────────────────────────

function MeddicTable({ summaries }: { summaries: CallSummaryEntry[] }) {
  const { t } = useTranslation('crm');
  const meddic = summaries.filter((s) => s.key in MEDDIC_LABELS);
  if (meddic.length === 0) {
    return (
      <p className="text-sm text-[var(--fg-tertiary)]">
        {t(
          'callSummary.meddicEmpty',
          'No MEDDIC signals extracted. Transcript may be too short or not yet processed.',
        )}
      </p>
    );
  }
  return (
    <table className="w-full text-sm border-collapse" aria-label={t('callSummary.meddicTableLabel', 'MEDDIC signal table')}>
      <thead>
        <tr>
          <th
            scope="col"
            className="py-2 pr-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]"
          >
            {t('callSummary.colDimension', 'Dimension')}
          </th>
          <th
            scope="col"
            className="py-2 pr-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]"
          >
            {t('callSummary.colExtractedSignal', 'Extracted signal')}
          </th>
          <th
            scope="col"
            className="py-2 text-left text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]"
          >
            {t('callSummary.colConfidence', 'Confidence')}
          </th>
        </tr>
      </thead>
      <tbody>
        {meddic.map((entry) => (
          <tr
            key={entry.id}
            className="border-t border-[var(--border-subtle)] align-top"
          >
            <td className="py-2 pr-3 font-medium text-[var(--fg-primary)] whitespace-nowrap">
              {t(`callSummary.dimension.${entry.key}`, MEDDIC_LABELS[entry.key] ?? entry.key)}
            </td>
            <td className="py-2 pr-3 text-[var(--fg-primary)] leading-snug">
              {entry.value}
              {entry.sourceQuoteRef && (
                <p className="mt-1 text-[11px] italic text-[var(--fg-tertiary)]">
                  &quot;{entry.sourceQuoteRef}&quot;
                </p>
              )}
            </td>
            <td className="py-2">
              <Badge tone={confidenceTone(entry.confidence)}>
                {Math.round(entry.confidence * 100)}%
              </Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Deal suggestions (human-in-the-loop only) ───────────────────────────────

function DealSuggestions({ summaries }: { summaries: CallSummaryEntry[] }) {
  const { t } = useTranslation('crm');
  const suggestions = summaries.filter((s) => s.key === 'DEAL_SUGGESTION');
  if (suggestions.length === 0) return null;
  return (
    <section aria-label={t('callSummary.dealSuggestionsLabel', 'Suggested deal updates')}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
        {t('callSummary.dealSuggestionsHeading', 'Suggested deal updates')}
      </p>
      <p className="mb-3 text-xs text-[var(--fg-tertiary)]">
        {t(
          'callSummary.dealSuggestionsNote',
          'These are AI suggestions only. Review before applying to the deal.',
        )}
      </p>
      <ul className="space-y-2" role="list">
        {suggestions.map((s) => (
          <li
            key={s.id}
            className={cn(
              'flex items-start gap-3 rounded-lg border border-[var(--border-default)] px-3 py-2.5',
              'bg-[var(--tag-amber-bg)] border-[var(--tag-amber-fg)]/20',
            )}
          >
            <span aria-hidden className="flex-shrink-0 text-base">💡</span>
            <span className="flex-1 text-sm text-[var(--fg-primary)] leading-snug">{s.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Talk ratio ───────────────────────────────────────────────────────────────

function TalkRatioBar({ ratio }: { ratio: Record<string, number> }) {
  const { t } = useTranslation('crm');
  const entries = Object.entries(ratio).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <section aria-label={t('callSummary.talkRatioLabel', 'Talk ratio')}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
        {t('callSummary.talkRatioHeading', 'Talk Ratio')}
      </p>
      <ul className="space-y-1.5" role="list">
        {entries.map(([speaker, pct]) => (
          <li key={speaker} className="flex items-center gap-3">
            <span className="w-24 flex-shrink-0 text-xs text-[var(--fg-secondary)] truncate">
              {speaker}
            </span>
            <div
              className="flex-1 overflow-hidden rounded-full bg-[var(--surface-sunken)] h-2"
              role="progressbar"
              aria-valuenow={Math.round(pct * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('callSummary.speakerTalkRatio', '{{speaker}} talk ratio', { speaker })}
            >
              <div
                className="h-full rounded-full bg-[var(--brand-primary)] transition-[width] duration-500"
                style={{ width: `${Math.round(pct * 100)}%` }}
              />
            </div>
            <span className="w-10 flex-shrink-0 text-right text-xs text-[var(--fg-secondary)]">
              {Math.round(pct * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── CallSummaryPanel ─────────────────────────────────────────────────────────

export interface CallSummaryPanelProps {
  callSessionId: string;
  className?: string;
}

export function CallSummaryPanel({ callSessionId, className }: CallSummaryPanelProps) {
  const { data: call, isLoading, isError } = useCall(callSessionId);
  const extractInsights = useExtractInsights(callSessionId);
  const { t } = useTranslation('crm');

  if (isLoading) {
    return (
      <div className={cn('space-y-3', className)} aria-busy="true" aria-label={t('callSummary.loadingLabel', 'Loading call summary')}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-5 w-full animate-pulse rounded bg-[var(--surface-sunken)]" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className={cn('rounded-lg border border-[var(--danger)] bg-[var(--surface-card)] p-4', className)} role="alert">
        <p className="text-sm text-[var(--danger)]">{t('callSummary.loadError', 'Failed to load call summary.')}</p>
      </div>
    );
  }

  if (!call) return null;

  const summaries: CallSummaryEntry[] = call.summaries ?? [];
  const talkRatio = call.talkRatio ?? {};
  const actionItems = Array.isArray(call.actionItems) ? call.actionItems : [];

  const hasInsights = summaries.length > 0 || call.summary || actionItems.length > 0;

  return (
    <div className={cn('space-y-6', className)}>
      {/* AI summary */}
      {call.summary && (
        <section aria-label={t('callSummary.aiSummaryLabel', 'AI summary')}>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
            {t('callSummary.summaryHeading', 'Summary')}
          </p>
          <p className="text-sm leading-relaxed text-[var(--fg-primary)]">{call.summary}</p>
        </section>
      )}

      {/* Action items (read-only in this panel) */}
      {actionItems.length > 0 && (
        <section aria-label={t('callSummary.actionItemsLabel', 'Action items')}>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
            {t('callSummary.actionItemsHeading', 'Action Items')}
          </p>
          <ul className="space-y-1" role="list">
            {actionItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[var(--fg-primary)]">
                <span aria-hidden className="flex-shrink-0 text-[var(--fg-tertiary)] mt-0.5">•</span>
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Talk ratio */}
      {Object.keys(talkRatio).length > 0 && (
        <TalkRatioBar ratio={talkRatio} />
      )}

      {/* MEDDIC signals */}
      <section aria-label={t('callSummary.meddicSignalsLabel', 'MEDDIC signals')}>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
          {t('callSummary.meddicSignalsHeading', 'MEDDIC Signals')}
        </p>
        <MeddicTable summaries={summaries} />
      </section>

      {/* Deal suggestions */}
      <DealSuggestions summaries={summaries} />

      {/* Empty state + re-extract */}
      {!hasInsights && (
        <div className="rounded-lg border border-dashed border-[var(--border-default)] px-6 py-8 text-center">
          <p className="mb-3 text-sm text-[var(--fg-tertiary)]">
            {call.transcriptText
              ? t('callSummary.analysisNotRun', 'AI analysis has not run yet.')
              : t(
                  'callSummary.transcriptUnavailable',
                  'Transcript not available. Insights will be extracted after the recording is processed.',
                )}
          </p>
          {call.transcriptText && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => extractInsights.mutate()}
              disabled={extractInsights.isPending}
              aria-busy={extractInsights.isPending}
            >
              {extractInsights.isPending
                ? t('callSummary.analysing', 'Analysing…')
                : t('callSummary.extractInsights', 'Extract insights now')}
            </Button>
          )}
        </div>
      )}

      {/* Re-trigger button when insights exist */}
      {hasInsights && call.transcriptText && (
        <div className="border-t border-[var(--border-subtle)] pt-4">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => extractInsights.mutate()}
            disabled={extractInsights.isPending}
            aria-busy={extractInsights.isPending}
          >
            {extractInsights.isPending
              ? t('callSummary.reAnalysing', 'Re-analysing…')
              : t('callSummary.reExtractInsights', 'Re-extract insights')}
          </Button>
        </div>
      )}
    </div>
  );
}
