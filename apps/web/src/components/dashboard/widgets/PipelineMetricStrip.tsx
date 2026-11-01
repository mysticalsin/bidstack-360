import { useTranslation } from 'react-i18next';

import {
  headlineMicrosLabel,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';
import {
  openPipelineStages,
  pipelineHeadline,
  stageBarShares,
  type PipelineStagePoint,
} from '@/components/dashboard/widgets/pipeline-headline';

/** Breathing dots while the pipeline figures load. Motion stops when reduced. */
export function ThinkingMark({ label }: { label: string }) {
  return (
    <span className="thinking-mark" role="status">
      <span aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {label}
    </span>
  );
}

function ShareBars({ values }: { values: readonly number[] }) {
  const max = Math.max(1, ...values);
  return (
    <span className="mt-3 flex h-7 items-end gap-1" aria-hidden="true">
      {values.map((value, index) => (
        <span
          key={index}
          className="min-w-1 flex-1 rounded-sm bg-[var(--brand-primary)]"
          style={{ height: `${Math.max(value > 0 ? 12 : 0, (value / max) * 100)}%` }}
        />
      ))}
    </span>
  );
}

/** Sourced pipeline figures. The bars are the recorded mix, not a trend. */
export function PipelineMetricStrip({
  stages,
  loading = false,
}: {
  stages: readonly PipelineStagePoint[] | undefined;
  loading?: boolean;
}) {
  const { t } = useTranslation('crm');
  if (loading && !stages) {
    return <ThinkingMark label={t('pipeline.figuresLoading', 'Loading the pipeline')} />;
  }
  if (!stages) return null;

  const headline = pipelineHeadline(stages);
  const open = openPipelineStages(stages);
  const winRate =
    headline.winRate === null
      ? t('pipeline.winRateNoClosedBids', 'No closed bids')
      : `${Math.round(headline.winRate * 100)}%`;
  const cards = [
    {
      label: t('pipeline.kpiOpenValue', 'Open pipeline'),
      value: headlineMicrosLabel(headline.openMicros),
      detail: t('pipeline.metricOpenDetail', 'Open stages only.'),
      basis: UNSPECIFIED_CURRENCY_BASIS,
      bars: stageBarShares(open),
    },
    {
      label: t('pipeline.kpiWonValue', 'Won'),
      value: headlineMicrosLabel(headline.wonMicros),
      detail: `${t('pipeline.metricWonDetail', 'Closed won. Count is the win rate numerator.')} ${UNSPECIFIED_CURRENCY_BASIS}`,
      basis: null,
      bars: [headline.wonValue],
    },
    {
      label: t('pipeline.kpiLostValue', 'Lost'),
      value: headlineMicrosLabel(headline.lostMicros),
      detail: `${t('pipeline.metricLostDetail', 'Closed lost, including a stage marked lost.')} ${UNSPECIFIED_CURRENCY_BASIS}`,
      basis: null,
      bars: [headline.lostValue],
    },
    {
      label: t('pipeline.kpiWinRate', 'Win rate'),
      value: winRate,
      detail: t('pipeline.metricWinDetail', 'Closed-won count divided by closed deals.'),
      basis: null,
      bars: [headline.winRate === null ? 0 : headline.winRate],
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-tour="pipeline-kanban">
      {cards.map((card) => (
        <article
          key={card.label}
          className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-4"
          aria-label={`${card.label}. ${card.value}${card.basis ? ' unspecified' : ''}. ${card.detail}${card.basis ? ` ${card.basis}` : ''}`}
        >
          <p className="text-xs text-[var(--fg-tertiary)]">{card.label}</p>
          <p className="mt-2 text-[28px] font-medium leading-none tabular-nums text-[var(--fg-primary)]">
            {card.value}
          </p>
          <p className="mt-2 text-xs text-[var(--fg-secondary)]">
            <span>{card.detail}</span>
            {card.basis ? (
              <>
                {' '}
                <span>{card.basis}</span>
              </>
            ) : null}
          </p>
          <ShareBars values={card.bars.length > 0 ? card.bars : [0]} />
        </article>
      ))}
    </div>
  );
}
