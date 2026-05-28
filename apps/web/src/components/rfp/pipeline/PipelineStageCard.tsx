import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { RfpStatusChip } from '@/components/rfp/shared/RfpStatusChip';
import type { PipelineStage, PipelineEvent } from '@/stores/rfpPipeline';

interface PipelineStageCardProps {
  stage: PipelineStage;
  progress: number;
  events: PipelineEvent[];
}

export function PipelineStageCard({ stage, progress, events }: PipelineStageCardProps) {
  const { t } = useTranslation('rfp');

  const latestEvents = events.slice(-5).reverse();

  return (
    <Card className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Spinner */}
          <span
            aria-hidden="true"
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--brand-primary)] border-t-transparent"
          />
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('pipeline.processing')}
          </h2>
        </div>
        <RfpStatusChip stage={stage} />
      </div>

      {/* Overall progress bar */}
      <div
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('pipeline.overallProgress')}
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border-subtle)]"
      >
        <div
          className="h-full rounded-full bg-[var(--brand-primary)] transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Event log */}
      {latestEvents.length > 0 && (
        <ul aria-label={t('pipeline.eventLog')} className="space-y-1.5" role="list">
          {latestEvents.map((ev, i) => (
            <li
              key={`${ev.timestamp}-${i}`}
              className="flex items-start gap-2 text-xs text-[var(--fg-secondary)]"
            >
              <span
                className="mt-0.5 shrink-0 font-mono text-[10px] text-[var(--fg-tertiary)]"
                aria-hidden="true"
              >
                {new Date(ev.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              <span>{ev.message}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
