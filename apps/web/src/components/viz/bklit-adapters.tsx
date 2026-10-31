// Polo adapters over the vendored bklit charts (src/components/charts, MIT,
// installed with `shadcn add @bklit/...`; see THIRD_PARTY_NOTICES.md).
// They pin Polo tokens (green accent via --chart-line-primary), hairline grids,
// compact margins, and reduced motion (duration 0, no stagger). Each chart is
// decorative to assistive tech: the ChartCard around it carries role="img",
// a written summary and a table toggle.
import { curveMonotoneX } from 'd3-shape';
import { useReducedMotion } from 'motion/react';

import { Area, AreaChart } from '@/components/charts/area-chart';
import { Bar } from '@/components/charts/bar';
import { BarChart } from '@/components/charts/bar-chart';
import { BarXAxis } from '@/components/charts/bar-x-axis';
import { AreaSparkline, BarSparkline } from '@/components/charts/bklit-sparkline';
import { FunnelChart } from '@/components/charts/funnel-chart';
import { Grid } from '@/components/charts/grid';
import { Line, LineChart } from '@/components/charts/line-chart';
import { Ring } from '@/components/charts/ring';
import { RingCenter } from '@/components/charts/ring-center';
import { RingChart } from '@/components/charts/ring-chart';
import { ChartTooltip } from '@/components/charts/tooltip';
import { XAxis } from '@/components/charts/x-axis';

const BRAND = 'var(--brand-primary, #006b4f)';
const WON = 'var(--success, #177048)';
const MUTED = 'color-mix(in srgb, var(--fg-tertiary, #6b6b6b) 45%, transparent)';
const MARGIN = { top: 16, right: 12, bottom: 28, left: 12 };

type Fmt = (v: number) => string;

/** Hero: cumulative won value as a gradient area that reveals left to right. */
export function HeroArea({ data, format, aspect = '3.2 / 1' }: { data: Array<{ date: Date; y: number }>; format: Fmt; aspect?: string }) {
  const reduced = useReducedMotion();
  if (data.length < 2) return null;
  return (
    <div aria-hidden className="viz-bk">
      <AreaChart data={data as unknown as Record<string, unknown>[]} aspectRatio={aspect} margin={MARGIN} animationDuration={reduced ? 0 : 1100}>
        <Grid horizontal numTicksRows={3} strokeDasharray="0" strokeOpacity={1} stroke="var(--viz-line)" />
        <Area dataKey="y" curve={curveMonotoneX} fill={BRAND} stroke={BRAND} strokeWidth={2} fillOpacity={0.28} />
        <XAxis numTicks={6} />
        <ChartTooltip rows={(p) => [{ color: BRAND, label: 'Won to date', value: format(Number(p.y ?? 0)) }]} />
      </AreaChart>
    </div>
  );
}

/** Win rate per close quarter, 0–100. */
export function WinRateLine({ data }: { data: Array<{ x: string; date: Date; rate: number; won: number; lost: number }> }) {
  const reduced = useReducedMotion();
  if (data.length < 2) return null;
  return (
    <div aria-hidden className="viz-bk">
      <LineChart data={data as unknown as Record<string, unknown>[]} aspectRatio="2.6 / 1" margin={MARGIN} animationDuration={reduced ? 0 : 1100}>
        <Grid horizontal numTicksRows={2} strokeDasharray="0" stroke="var(--viz-line)" />
        <Line dataKey="rate" curve={curveMonotoneX} stroke={BRAND} strokeWidth={2} />
        <XAxis numTicks={data.length} tickMode="data" labels={data.map((d) => d.x)} />
        <ChartTooltip rows={(p) => [
          { color: BRAND, label: 'Win rate', value: `${p.rate}%` },
          { color: WON, label: 'Won', value: Number(p.won ?? 0) },
          { color: MUTED, label: 'Lost', value: Number(p.lost ?? 0) },
        ]} />
      </LineChart>
    </div>
  );
}

/** Won actuals and weighted forecast per quarter. */
export function QuarterBars({ data, format }: { data: Array<{ label: string; won: number; weighted: number }>; format: Fmt }) {
  const reduced = useReducedMotion();
  if (!data.length) return null;
  return (
    <div aria-hidden className="viz-bk">
      <BarChart data={data} xDataKey="label" aspectRatio="2.6 / 1" margin={{ ...MARGIN, top: 24 }} barGap={0.3}
        animationDuration={reduced ? 0 : 900} enterTransition={reduced ? { duration: 0 } : undefined}>
        <Grid horizontal numTicksRows={3} strokeDasharray="0" stroke="var(--viz-line)" />
        <Bar dataKey="won" fill={WON} lineCap="round" animate={!reduced} staggerDelay={reduced ? 0 : 0.06} />
        <Bar dataKey="weighted" fill={`color-mix(in srgb, ${BRAND} 45%, transparent)`} lineCap="round" animate={!reduced} staggerDelay={reduced ? 0 : 0.06} />
        <BarXAxis />
        <ChartTooltip rows={(p) => [
          { color: WON, label: 'Won', value: format(Number(p.won ?? 0)) },
          { color: BRAND, label: 'Weighted forecast', value: format(Number(p.weighted ?? 0)) },
        ]} />
      </BarChart>
    </div>
  );
}

/** "S3 technical iteration" -> "Technical": keeps funnel labels on one line. */
const shortStage = (l: string) => {
  const w = l.replace(/^S\d+\s+/i, '').split(/\s+/)[0] ?? l;
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** Open value per stage as a horizontal funnel. */
export function StageFunnel({ data, format }: { data: Array<{ label: string; value: number; count: number }>; format: Fmt }) {
  const reduced = useReducedMotion();
  if (!data.length) return null;
  return (
    <div aria-hidden className="viz-bk">
      <FunnelChart
        data={data.map((d) => ({ label: shortStage(d.label), value: Math.max(d.value, 1), displayValue: `${format(d.value)} · ${d.count}` }))}
        orientation="horizontal"
        color={BRAND}
        layers={2}
        edges="curved"
        showPercentage={false}
        gap={4}
        staggerDelay={reduced ? 0 : 0.08}
        enterTransition={reduced ? { duration: 0 } : undefined}
        style={{ aspectRatio: '2.4 / 1' }}
      />
    </div>
  );
}

/** Open / won / lost as concentric progress rings over all bids. */
export function StatusRings({ data, total, size = 168 }: { data: Array<{ label: string; value: number; color: string }>; total: number; size?: number }) {
  const reduced = useReducedMotion();
  if (!total) return null;
  return (
    <div aria-hidden className="viz-bk viz-bk-ring">
      <RingChart data={data.map((d) => ({ ...d, maxValue: total }))} size={size} strokeWidth={12} ringGap={6}
        animationDuration={reduced ? 0 : 1100} enterTransition={reduced ? { duration: 0 } : undefined}>
        {data.map((d, i) => <Ring key={d.label} index={i} color={d.color} animate={!reduced} lineCap="round" />)}
        <RingCenter defaultLabel="bids" />
      </RingChart>
    </div>
  );
}

/** Tiny trend for header metrics; bars for counts, area for running totals. */
export function MetricSpark({ values, mode = 'area', label }: { values: number[]; mode?: 'area' | 'bars'; label: string }) {
  const reduced = useReducedMotion();
  if (values.length < 2) return null;
  const data = values.map((v, i) => ({ i, v }));
  return (
    <span className="viz-bk-spark" role="img" aria-label={label}>
      {mode === 'bars'
        ? <BarSparkline data={data} dataKey="v" height={24} animate={!reduced} />
        : <AreaSparkline data={data} dataKey="v" height={24} animate={!reduced} />}
    </span>
  );
}
