import { useTranslation } from 'react-i18next';

import type { PipelineStage } from '@/stores/rfpPipeline';

/**
 * Ordered stages that appear in the progress bar (not idle/failed/approved).
 * WHY queued/extracting: QA-9 renamed 'uploading'→'queued' and
 * 'extraction'→'extracting' to match server RfpOrchestration.state values.
 */
const ORDERED_STAGES: PipelineStage[] = [
  'queued',
  'extracting',
  'story_matching',
  'section_drafting',
  'compliance_fill',
  'legal_scan',
  'qa_review',
];

interface PipelineProgressProps {
  currentStage: PipelineStage;
}

export function PipelineProgress({ currentStage }: PipelineProgressProps) {
  const { t } = useTranslation('rfp');

  const currentIdx = ORDERED_STAGES.indexOf(currentStage);
  // awaiting_approval and approved = all stages done
  const isTerminalSuccess = currentStage === 'awaiting_approval' || currentStage === 'approved';

  return (
    <nav aria-label={t('pipeline.progressLabel')} className="w-full">
      <ol className="flex items-center gap-0" role="list">
        {ORDERED_STAGES.map((stage, idx) => {
          const isDone = isTerminalSuccess || currentIdx > idx;
          const isActive = currentIdx === idx;
          const isFailed = currentStage === 'failed';

          return (
            <li key={stage} className="flex flex-1 items-center">
              {/* Step dot */}
              <div className="flex flex-col items-center">
                <div
                  className={[
                    'h-7 w-7 rounded-full border-2 flex items-center justify-center text-xs font-semibold transition-colors',
                    isDone
                      ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white'
                      : isActive
                        ? isFailed
                          ? 'border-red-500 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                          : 'border-[var(--brand-primary)] bg-[var(--surface-card)] text-[var(--brand-primary)]'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-card)] text-[var(--fg-tertiary)]',
                  ].join(' ')}
                  aria-current={isActive ? 'step' : undefined}
                >
                  {isDone ? <span aria-hidden="true">✓</span> : <span>{idx + 1}</span>}
                </div>
                <span
                  className={[
                    'mt-1 text-[10px] font-medium whitespace-nowrap',
                    isActive ? 'text-[var(--fg-primary)]' : 'text-[var(--fg-tertiary)]',
                  ].join(' ')}
                >
                  {t(`pipeline.stages.${stage}`)}
                </span>
              </div>
              {/* Connector line */}
              {idx < ORDERED_STAGES.length - 1 && (
                <div
                  className={[
                    'mt-[-14px] h-0.5 flex-1 transition-colors',
                    isDone ? 'bg-[var(--brand-primary)]' : 'bg-[var(--border-subtle)]',
                  ].join(' ')}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
