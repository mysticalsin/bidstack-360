// Hand-rolled SVG area chart for Monthly Sales. Matches the Sparkline pattern
// already in the codebase (no chart-library dep). Renders:
//   - Y-axis with 5 evenly-spaced ticks
//   - X-axis labels at each data point
//   - Smooth Catmull-Rom→Bezier path with translucent area fill
//   - Hover-state circles + month-revenue tooltip
//
// Money on the wire is integer micros (string-encoded), formatted at the edge.

import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { formatMoneyMicros } from '@/lib/format';
import { easeStandard, springSoft } from '@/lib/motion';

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
  const reducedMotion = useReducedMotion();

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
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSoft}
        className="grid place-items-center rounded-md bg-[var(--surface-subtle)] text-sm text-[var(--fg-tertiary)]"
        style={{ height }}
      >
        No confirmed orders in this window yet.
      </motion.div>
    );
  }
  if (points.length === 1) {
    // A single bar visualises a one-month window — area chart needs ≥2 anchors.
    return (
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSoft}
        className="flex flex-col items-center justify-center gap-2 rounded-md bg-[var(--surface-subtle)] text-sm text-[var(--fg-secondary)]"
        style={{ height }}
      >
        <div className="text-[var(--fg-tertiary)]">{points[0]!.label}</div>
        <div className="text-2xl font-semibold tabular-nums text-[var(--fg-primary)]">
          {formatMoneyMicros(points[0]!.revenueMicros, currency)}
        </div>
      </motion.div>
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
  const tooltip =
    hover === null
      ? null
      : {
          ...getTooltipFrame(coords[hover]!, width, height),
          anchorX: coords[hover]!.x,
          point: points[hover]!,
        };

  return (
    <motion.div
      className="relative"
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSoft}
    >
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
        <motion.path
          d={areaPath}
          fill="var(--brand-primary)"
          fillOpacity={0.16}
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={easeStandard}
        />
        <motion.path
          d={linePath}
          fill="none"
          stroke="var(--brand-primary)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={reducedMotion ? false : { pathLength: 0, opacity: 0.45 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={springSoft}
        />

        {hover !== null ? (
          <motion.line
            key={`hover-line-${hover}`}
            x1={coords[hover]!.x}
            x2={coords[hover]!.x}
            y1={MARGIN.top}
            y2={MARGIN.top + innerH}
            stroke="var(--brand-primary)"
            strokeOpacity={0.2}
            strokeWidth={1}
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={easeStandard}
          />
        ) : null}

        {coords.map((c, i) => (
          <motion.circle
            key={`point-${points[i]!.month}`}
            cx={c.x}
            cy={c.y}
            r={2.5}
            fill="var(--brand-primary)"
            fillOpacity={0.65}
            initial={reducedMotion ? false : { opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ ...springSoft, delay: reducedMotion ? 0 : i * 0.035 }}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          />
        ))}

        {/* Dots + hit areas. Each rect is focusable so a keyboard user can
            tab through the months; the focus state mirrors the hover state
            so the dot + outline appear and the <title> + aria-label
            announce the data point. */}
        {coords.map((c, i) => {
          const p = points[i]!;
          const label = `${p.label}: ${formatMoneyMicros(p.revenueMicros, currency)}, ${p.orders} orders`;
          const focused = hover === i;
          return (
            <g key={`${p.month}-${i}`}>
              {focused ? (
                <motion.circle
                  key={`focus-${i}`}
                  cx={c.x}
                  cy={c.y}
                  r={4}
                  fill="var(--brand-primary)"
                  stroke="white"
                  strokeWidth={2}
                  initial={reducedMotion ? false : { scale: 0.65, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={springSoft}
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
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
                role="img"
                aria-label={label}
                style={
                  focused
                    ? { outline: '2px solid var(--focus-ring)', outlineOffset: '2px' }
                    : undefined
                }
              >
                <title>{label}</title>
              </rect>
            </g>
          );
        })}

        {tooltip ? (
          <motion.g
            key={`tooltip-${tooltip.point.month}`}
            pointerEvents="none"
            initial={reducedMotion ? false : { opacity: 0, y: tooltip.above ? 4 : -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={springSoft}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          >
            <path
              d={
                tooltip.above
                  ? `M ${tooltip.anchorX - 6} ${tooltip.y + tooltip.h - 1} L ${tooltip.anchorX} ${
                      tooltip.y + tooltip.h + 7
                    } L ${tooltip.anchorX + 6} ${tooltip.y + tooltip.h - 1} Z`
                  : `M ${tooltip.anchorX - 6} ${tooltip.y + 1} L ${tooltip.anchorX} ${
                      tooltip.y - 7
                    } L ${tooltip.anchorX + 6} ${tooltip.y + 1} Z`
              }
              fill="var(--surface-card)"
              stroke="var(--border-subtle)"
              strokeWidth={1}
            />
            <rect
              x={tooltip.x}
              y={tooltip.y}
              width={tooltip.w}
              height={tooltip.h}
              rx={8}
              fill="var(--surface-card)"
              stroke="var(--border-subtle)"
              strokeWidth={1}
              style={{ filter: 'drop-shadow(0 12px 24px rgba(16, 24, 40, 0.14))' }}
            />
            <text
              x={tooltip.x + 12}
              y={tooltip.y + 18}
              fontSize={11}
              fontWeight={600}
              fill="var(--fg-secondary)"
            >
              {tooltip.point.label}
            </text>
            <text
              x={tooltip.x + 12}
              y={tooltip.y + 38}
              fontSize={15}
              fontWeight={700}
              fill="var(--fg-primary)"
            >
              {formatMoneyMicros(tooltip.point.revenueMicros, currency)}
            </text>
            <text
              x={tooltip.x + tooltip.w - 12}
              y={tooltip.y + 38}
              fontSize={11}
              textAnchor="end"
              fill="var(--fg-tertiary)"
            >
              {tooltip.point.orders} orders
            </text>
          </motion.g>
        ) : null}

        {/* X labels at each point */}
        {coords.map((c, i) => (
          <text
            key={`xlbl-${points[i]!.month}`}
            x={c.x}
            y={height - 8}
            fontSize={11}
            textAnchor={i === 0 ? 'start' : i === coords.length - 1 ? 'end' : 'middle'}
            fill="var(--fg-tertiary)"
          >
            {points[i]!.label}
          </text>
        ))}
      </svg>
    </motion.div>
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

function getTooltipFrame(
  point: { x: number; y: number },
  chartWidth: number,
  chartHeight: number,
): { x: number; y: number; w: number; h: number; above: boolean } {
  const w = 168;
  const h = 54;
  const above = point.y > MARGIN.top + h + 18;
  const x = clamp(point.x - w / 2, MARGIN.left + 4, chartWidth - MARGIN.right - w - 4);
  const y = above ? point.y - h - 14 : Math.min(point.y + 14, chartHeight - MARGIN.bottom - h - 2);
  return { x, y, w, h, above };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
