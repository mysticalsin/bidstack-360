/**
 * dashboard/widgets/PipelineCard.tsx — open pipeline value card with animated
 * sparkline chart grouped by stage.
 *
 * WHY a separate module: PipelineCard + PipelineLiveChart + smoothLinePath
 * together are ~144 source lines of SVG/animation logic. The chart helper
 * `smoothLinePath` lives here since it's consumed only by PipelineLiveChart.
 */
import { type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { GlassCard } from '@/components/ui/GlassCard';
import { springSoft } from '@/lib/motion';
import { formatMoney } from '@/lib/format';

import {
  type PipelineStagePoint,
  type SignalPoint,
  stageColor,
  stageLabel,
} from './dashboard-types';

// ─── PipelineCard ────────────────────────────────────────────────────────────

export function PipelineCard({
  value,
  count,
  currency,
  stages,
  reduced,
}: {
  value: number;
  count: number;
  currency: string;
  stages: PipelineStagePoint[];
  reduced: boolean | null;
}) {
  const { t } = useTranslation('crm');
  const chartPoints =
    stages.length > 0
      ? stages.map((stage) => ({
          label: stageLabel(stage.stage),
          value: stage.valueSum,
          color: stageColor(stage.stage),
        }))
      : [
          {
            label: t('pipeline.openOpportunitiesLabel', 'Open opportunities'),
            value: count,
            color: 'var(--tag-teal-fg)',
          },
        ];

  return (
    <GlassCard className="text-center" hoverable={false}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {t('pipeline.heading', 'Open pipeline')}
      </div>
      <div className="mt-2 text-3xl font-bold tabular-nums text-[var(--fg-primary)]">
        {formatMoney(value, currency)}
      </div>
      <div className="mt-1 text-xs text-[var(--fg-secondary)]">
        {count === 1
          ? t('pipeline.openCount_one', '{{count}} open opportunity', { count })
          : t('pipeline.openCount_other', '{{count}} open opportunities', { count })}
      </div>
      <PipelineLiveChart points={chartPoints} reduced={reduced} />
    </GlassCard>
  );
}

// ─── PipelineLiveChart (private) ─────────────────────────────────────────────

function PipelineLiveChart({
  points,
  reduced,
}: {
  points: SignalPoint[];
  reduced: boolean | null;
}) {
  const { t } = useTranslation('crm');
  const visible = points.filter((point) => Number.isFinite(point.value) && point.value > 0);

  if (visible.length === 0) {
    return (
      <div className="pipeline-live-empty">
        <span>{t('pipeline.emptyStageValue', 'No stage value yet')}</span>
      </div>
    );
  }

  const chartPoints = visible.length === 1 ? [{ ...visible[0]!, value: 0 }, visible[0]!] : visible;
  const width = 168;
  const height = 48;
  const pad = 4;
  const max = Math.max(...chartPoints.map((point) => point.value), 1);
  const min = Math.min(...chartPoints.map((point) => point.value), 0);
  const range = max - min || 1;
  const mapped = chartPoints.map((point, index) => {
    const x = pad + (index / Math.max(chartPoints.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - ((point.value - min) / range) * (height - pad * 2);
    return { ...point, x, y };
  });
  const linePath = smoothLinePath(mapped);
  const first = mapped[0]!;
  const last = mapped[mapped.length - 1]!;
  const fillPath = `${linePath} L ${last.x.toFixed(2)} ${height - pad} L ${first.x.toFixed(2)} ${
    height - pad
  } Z`;

  return (
    <div
      className="pipeline-live-visual"
      role="img"
      aria-label={t('pipeline.chartAriaLabel', 'Pipeline stage value distribution')}
    >
      <svg viewBox={`0 0 ${width} ${height}`} className="pipeline-live-chart" aria-hidden>
        <defs>
          <linearGradient id="pipeline-live-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--tag-teal-fg)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--tag-teal-fg)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <motion.path
          d={fillPath}
          fill="url(#pipeline-live-fill)"
          initial={reduced ? { opacity: 0.2 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduced ? 0 : 0.5, ease: 'easeOut' }}
        />
        <motion.path
          d={linePath}
          fill="none"
          stroke="var(--tag-teal-fg)"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduced ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0.5 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: reduced ? 0 : 0.9, ease: [0.2, 0.8, 0.2, 1] }}
        />
        {mapped.map((point, index) => (
          <motion.circle
            key={`${point.label}-${index}`}
            cx={point.x}
            cy={point.y}
            r="3"
            fill={point.color ?? 'var(--tag-teal-fg)'}
            initial={reduced ? { scale: 1, opacity: 1 } : { scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...springSoft, delay: reduced ? 0 : 0.25 + index * 0.05 }}
          />
        ))}
      </svg>
      <div className="pipeline-stage-strip" aria-hidden>
        {visible.slice(0, 6).map((point, index) => (
          <motion.span
            key={`${point.label}-${index}`}
            className="pipeline-stage-tick"
            style={{ '--stage-color': point.color ?? 'var(--tag-teal-fg)' } as CSSProperties}
            initial={reduced ? { scaleY: 1 } : { scaleY: 0.35 }}
            animate={{ scaleY: 1 }}
            transition={{ ...springSoft, delay: reduced ? 0 : 0.15 + index * 0.04 }}
            title={`${point.label}: ${Math.round(point.value).toLocaleString()}`}
          />
        ))}
      </div>
    </div>
  );
}

// ─── smoothLinePath (private — cubic bezier SVG path) ────────────────────────

function smoothLinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return rest.reduce(
    (path, point, index) => {
      const previous = points[index]!;
      const midX = (previous.x + point.x) / 2;
      return `${path} C ${midX.toFixed(2)} ${previous.y.toFixed(2)}, ${midX.toFixed(2)} ${point.y.toFixed(
        2,
      )}, ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    },
    `M ${first!.x.toFixed(2)} ${first!.y.toFixed(2)}`,
  );
}
