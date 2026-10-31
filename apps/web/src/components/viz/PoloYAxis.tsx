// Minimal left y-axis for bklit time-series charts (Polo-authored). Named
// `YAxis` so bklit keeps it outside the series reveal clip, like Grid/XAxis.
// Reads the settled y-scale, so labels don't jitter during the domain tween.
import { useSettledYScale } from '@/components/charts/chart-context';

export function YAxis({ ticks, format = String }: { ticks: number[]; format?: (n: number) => string }) {
  const scale = useSettledYScale();
  return (
    <g aria-hidden="true" className="viz-yaxis">
      {ticks.map((t) => (
        <text key={t} x={-8} y={scale(t)} dy="0.32em" textAnchor="end" fontSize={11}
          fill="var(--viz-meta, var(--fg-tertiary))" style={{ fontVariantNumeric: 'tabular-nums' }}
         >
          {format(t)}
        </text>
      ))}
    </g>
  );
}
YAxis.displayName = 'YAxis';
