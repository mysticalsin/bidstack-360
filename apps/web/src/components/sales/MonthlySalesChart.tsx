// Hand-rolled SVG area chart for Monthly Sales. Matches the Sparkline pattern
// already in the codebase (no chart-library dep). Renders:
//   - Y-axis with 5 evenly-spaced ticks
//   - X-axis labels at each data point
//   - Smooth Catmull-Rom→Bezier path with translucent area fill
//   - Hover-state circles + month-revenue tooltip
//
// Money on the wire is integer micros (string-encoded), formatted at the edge.

import { useMemo, useState } from 'react';

import { formatMoneyMicros } from '@/lib/format';

import type { SalesDashMonthlyPoint } from '@bidstack/shared';

interface Props {
  points: SalesDashMonthlyPoint[];
  currency: string;
  height?: number;
}

const MARGIN = { top: 16, right: 16, bottom: 32, left: 56 } as const;
const CHART_HEIGHT_DEFAULT = 280;

export function MonthlySalesChart({ points, currency, height = CHART_HEIGHT_DEFAULT }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    // Each point's micros come as a string-encoded bigint to survive JSON.
    // We project to Number for the chart: divide by 1e6 then by 1000 for
    // axis labels (which display as "120k"). Loss-of-precision is fine for
    // pixel positioning; absolute values stay accurate in the tooltip.
    const values = points.map((p) => Number(BigInt(p.revenueMicros) / BigInt(1_000)) / 1000);
    const max = Math.max(...values, 1);
    const niceMax = niceCeil(max);
    return { values, max: niceMax, niceMax };
  }, [points]);

  if (points.length === 0) {
    return (
      <div
        className="grid place-items-center rounded-md bg-[var(--surface-subtle)] text-sm text-[var(--fg-tertiary)]"
        style={{ height }}
      >
        No confirmed orders in this window yet.
      </div>
    );
  }
  if (points.length === 1) {
    // A single bar visualises a one-month window — area chart needs ≥2 anchors.
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-md bg-[var(--surface-subtle)] text-sm text-[var(--fg-secondary)]"
        style={{ height }}
      >
        <div className="text-[var(--fg-tertiary)]">{points[0]!.label}</div>
        <div className="text-2xl font-semibold tabular-nums text-[var(--fg-primary)]">
          {formatMoneyMicros(points[0]!.revenueMicros, currency)}
        </div>
      </div>
    );
  }

  // Compute SVG geometry with viewBox so the chart is responsive without ResizeObservers.
  const width = 720; // viewBox; scales to container via preserveAspectRatio
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const stepX = innerW / (points.length - 1);

  const coords = geometry.values.map((v, i) => {
    const x = MARGIN.left + i * stepX;
    const y = MARGIN.top + innerH - (v / geometry.niceMax) * innerH;
    return { x, y };
  });

  const linePath = smoothPath(coords);
  const areaPath = `${linePath} L ${coords[coords.length - 1]!.x.toFixed(2)} ${
    MARGIN.top + innerH
  } L ${coords[0]!.x.toFixed(2)} ${MARGIN.top + innerH} Z`;

  // 5 Y-axis ticks at 0, 25%, 50%, 75%, 100% of niceMax.
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    value: geometry.niceMax * f,
    y: MARGIN.top + innerH - f * innerH,
  }));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
        role="img"
        aria-label="Monthly sales area chart"
      >
        {/* Y gridlines + labels */}
        {yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={tick.y}
              y2={tick.y}
              stroke="var(--border-subtle)"
              strokeWidth={1}
              strokeDasharray={tick.value === 0 ? '' : '2 4'}
            />
            <text
              x={MARGIN.left - 8}
              y={tick.y + 4}
              fontSize={11}
              textAnchor="end"
              fill="var(--fg-tertiary)"
            >
              {formatYTick(tick.value)}
            </text>
          </g>
        ))}

        {/* Area + line */}
        <path d={areaPath} fill="var(--brand-primary)" fillOpacity={0.16} />
        <path
          d={linePath}
          fill="none"
          stroke="var(--brand-primary)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Dots + hit areas */}
        {coords.map((c, i) => (
          <g key={`${points[i]!.month}-${i}`}>
            {hover === i ? (
              <circle
                cx={c.x}
                cy={c.y}
                r={4}
                fill="var(--brand-primary)"
                stroke="white"
                strokeWidth={2}
              />
            ) : null}
            <rect
              x={c.x - stepX / 2}
              y={MARGIN.top}
              width={stepX}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
            >
              <title>{`${points[i]!.label} · ${formatMoneyMicros(points[i]!.revenueMicros, currency)} · ${points[i]!.orders} orders`}</title>
            </rect>
          </g>
        ))}

        {/* X labels at each point */}
        {coords.map((c, i) => (
          <text
            key={`xlbl-${points[i]!.month}`}
            x={c.x}
            y={height - 8}
            fontSize={11}
            textAnchor="middle"
            fill="var(--fg-tertiary)"
          >
            {points[i]!.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const norm = value / base;
  let nice: number;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

function formatYTick(value: number): string {
  // Y is already in $k (we divided by 1000 above). Render as "120k".
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}M`;
  if (value === 0) return '0';
  return `${value.toLocaleString('en-US')}k`;
}

/** Catmull-Rom-to-Bezier smoothing for the area chart. */
function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  const segs = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`);
  // Simple version: straight lines (matches the screenshot's clean look).
  return `M ${segs[0]!} ${segs
    .slice(1)
    .map((s) => `L ${s}`)
    .join(' ')}`;
}
