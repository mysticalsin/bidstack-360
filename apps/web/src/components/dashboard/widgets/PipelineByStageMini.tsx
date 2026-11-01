import { useTranslation } from 'react-i18next';

import { PipelineOpenChart } from '@/pages/pipelineBoard/PipelineOpenChart';

import { openPipelineStages, type PipelineStagePoint } from './pipeline-headline';

export { openPipelineStages, pipelineHeadline, type PipelineStagePoint } from './pipeline-headline';

/** Open-pipeline chart for the home dashboard. Same bars as the pipeline page. */
export function PipelineByStageMini({
  report,
}: {
  report: { byStage: PipelineStagePoint[] } | undefined;
}) {
  const { t } = useTranslation('crm');
  if (!report || report.byStage.length === 0) return null;
  const open = openPipelineStages(report.byStage);

  return (
    <section aria-label={t('pipelineByStageMini.heading', 'Pipeline by stage')}>
      <h2 className="text-sm font-medium text-[var(--fg-primary)]">
        {t('pipelineByStageMini.heading', 'Pipeline by stage')}
      </h2>
      <p className="mt-1 text-sm text-[var(--fg-secondary)]">
        {t(
          'pipelineByStageMini.openCaption',
          'Open stages only. Closed won and lost stay in the win rate.',
        )}
      </p>
      {open.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--fg-secondary)]">
          {t('pipelineByStageMini.emptyOpen', 'No open pipeline.')}
        </p>
      ) : (
        <div className="mt-4">
          <PipelineOpenChart stages={report.byStage} />
        </div>
      )}
    </section>
  );
}
