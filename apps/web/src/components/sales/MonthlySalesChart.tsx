// Premium Monthly Sales Area Chart
// Smooth Catmull-Rom splines, gradient fill, glow stroke, animated dots,
// and a rich glass tooltip. Responsive via viewBox.

import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { useFormatMoney } from '@/hooks/useFormatMoney';
import { easeStandard, springSoft } from '@/lib/motion';

import type { SalesDashMonthlyPoint } from '@bidstack/shared';

interface Props {
  points: SalesDashMonthlyPoint[];
  height?: number;
  sourceCurrency?: string;
}

const MARGIN = { top: 20, right: 16, bottom: 36, left: 56 } as const;
const CHART_HEIGHT_DEFAULT = 300;

export function MonthlySalesChart({
  points,
  height = CHART_HEIGHT_DEFAULT,
  sourceCurrency = 'CAD',
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const reducedMotion = useReducedMotion();
  const { convert, formatMoneyMicros: fmtMicros } = useFormatMoney();

  const geometry = useMemo(() => {
    const values = points.map((p) => {
      const converted = convertedMicros(p.revenueMicros, convert, sourceCurrency);
      return Number(BigInt(converted) / BigInt(1_000)) / 1000;
    });
    const max = Math.max(...values, 1);
    const niceMax = niceCeil(max);
    return { values, max: niceMax, niceMax };
  }, [points, convert, sourceCurrency]);

  if (points.length === 0) {
    return (
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSoft}
        className="grid place-items-center rounded-xl bg-[var(--surface-subtle)] text-sm text-[var(--fg-tertiary)]"
        style={{ height }}
      >
        No confirmed orders in this window yet.
      </motion.div>
    );
  }

  if (points.length === 1) {
    return (
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSoft}
        className="flex flex-col items-center justify-center gap-2 rounded-xl bg-[var(--surface-subtle)] text-sm text-[var(--fg-secondary)]"
        style={{ height }}
      >
        <div className="text-[var(--fg-tertiary)]">{points[0]!.label}</div>
        <div className="text-3xl font-bold tabular-nums text-[var(--fg-primary)]">
          {fmtMicros(points[0]!.revenueMicros, sourceCurrency)}
        </div>
      </motion.div>
    );
  }

  const width = 720;
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const stepX = innerW / (points.length - 1);

  const coords = geometry.values.map((v, i) => {
    const x = MARGIN.left + i * stepX;
    const y = MARGIN.top + innerH - (v / geometry.niceMax) * innerH;
    return { x, y };
  });

  const linePath = splinePath(coords);
  const areaPath = `${linePath} L ${coords[coords.length - 1]!.x.toFixed(2)} ${
    MARGIN.top + innerH
  } L ${coords[0]!.x.toFixed(2)} ${MARGIN.top + innerH} Z`;

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
        <defs>
          <linearGradient id="sales-area-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity="0.28" />
            <stop offset="60%" stopColor="var(--brand-primary)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity="0" />
          </linearGradient>
          <filter id="sales-shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow
              dx="0"
              dy="2"
              stdDeviation="3"
              floodColor="var(--brand-primary)"
              floodOpacity="0.12"
            />
          </filter>
        </defs>

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
              opacity={tick.value === 0 ? 0.3 : 0.2}
            />
            <text
              x={MARGIN.left - 10}
              y={tick.y + 4}
              fontSize={10}
              fontWeight={400}
              textAnchor="end"
              fill="var(--fg-tertiary)"
            >
              {formatYTick(tick.value)}
            </text>
          </g>
        ))}

        {/* Area fill */}
        <motion.path
          d={areaPath}
          fill="url(#sales-area-gradient)"
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...easeStandard, duration: 0.8 }}
        />

        {/* Shadow line */}
        <motion.path
          d={linePath}
          fill="none"
          stroke="var(--brand-primary)"
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.15}
          filter="url(#sales-shadow)"
          initial={reducedMotion ? false : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.15 }}
          transition={{ ...springSoft, duration: 1.2 }}
        />

        {/* Main line */}
        <motion.path
          d={linePath}
          fill="none"
          stroke="var(--brand-primary)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={reducedMotion ? false : { pathLength: 0, opacity: 0.5 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ ...springSoft, duration: 1.2 }}
        />

        {/* Hover guide line */}
        {hover !== null ? (
          <motion.line
            key={`hover-line-${hover}`}
            x1={coords[hover]!.x}
            x2={coords[hover]!.x}
            y1={MARGIN.top}
            y2={MARGIN.top + innerH}
            stroke="var(--brand-primary)"
            strokeOpacity={0.15}
            strokeWidth={1}
            strokeDasharray="4 4"
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={easeStandard}
          />
        ) : null}

        {/* Static dots */}
        {coords.map((c, i) => (
          <motion.circle
            key={`dot-${points[i]!.month}`}
            cx={c.x}
            cy={c.y}
            r={3}
            fill="var(--brand-primary)"
            fillOpacity={0.5}
            initial={reducedMotion ? false : { opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ ...springSoft, delay: reducedMotion ? 0 : i * 0.04 + 0.3 }}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          />
        ))}

        {/* Focused dot */}
        {hover !== null ? (
          <motion.circle
            key={`focus-${hover}`}
            cx={coords[hover]!.x}
            cy={coords[hover]!.y}
            r={6}
            fill="var(--surface-card)"
            stroke="var(--brand-primary)"
            strokeWidth={2.5}
            initial={reducedMotion ? false : { scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={springSoft}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          />
        ) : null}

        {/* Hit areas */}
        {coords.map((c, i) => {
          const p = points[i]!;
          const label = `${p.label}: ${fmtMicros(p.revenueMicros, sourceCurrency)}, ${p.orders} orders`;
          const focused = hover === i;
          return (
            <g key={`${p.month}-${i}`}>
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
                    ? { outline: '2px solid var(--focus-ring-color)', outlineOffset: '2px' }
                    : undefined
                }
              >
                <title>{label}</title>
              </rect>
            </g>
          );
        })}

        {/* Tooltip */}
        {tooltip ? (
          <motion.g
            key={`tooltip-${tooltip.point.month}`}
            pointerEvents="none"
            initial={reducedMotion ? false : { opacity: 0, y: tooltip.above ? 6 : -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={springSoft}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          >
            <rect
              x={tooltip.x}
              y={tooltip.y}
              width={tooltip.w}
              height={tooltip.h}
              rx={8}
              fill="var(--surface-card)"
              stroke="var(--border-subtle)"
              strokeWidth={1}
              style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.08))' }}
            />
            <text
              x={tooltip.x + 14}
              y={tooltip.y + 20}
              fontSize={11}
              fontWeight={600}
              fill="var(--fg-secondary)"
            >
              {tooltip.point.label}
            </text>
            <text
              x={tooltip.x + 14}
              y={tooltip.y + 42}
              fontSize={16}
              fontWeight={700}
              fill="var(--fg-primary)"
            >
              {fmtMicros(tooltip.point.revenueMicros, sourceCurrency)}
            </text>
            <text
              x={tooltip.x + tooltip.w - 14}
              y={tooltip.y + 42}
              fontSize={11}
              fontWeight={500}
              textAnchor="end"
              fill="var(--fg-tertiary)"
            >
              {tooltip.point.orders} orders
            </text>
          </motion.g>
        ) : null}

        {/* X labels */}
        {coords.map((c, i) => (
          <text
            key={`xlbl-${points[i]!.month}`}
            x={c.x}
            y={height - 10}
            fontSize={10}
            fontWeight={400}
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
  if (value >= 1_000_000_000)
    return `${(value / 1_000_000_000).toFixed(value % 1_000_000_000 === 0 ? 0 : 1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
  if (value === 0) return '0';
  return value.toLocaleString('en-US');
}

function getTooltipFrame(
  point: { x: number; y: number },
  chartWidth: number,
  chartHeight: number,
): { x: number; y: number; w: number; h: number; above: boolean } {
  const w = 176;
  const h = 58;
  const above = point.y > MARGIN.top + h + 20;
  const x = clamp(point.x - w / 2, MARGIN.left + 4, chartWidth - MARGIN.right - w - 4);
  const y = above ? point.y - h - 14 : Math.min(point.y + 14, chartHeight - MARGIN.bottom - h - 2);
  return { x, y, w, h, above };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function convertedMicros(
  micros: string,
  convert: ((amount: number, from: string) => number) | undefined,
  sourceCurrency: string,
): string {
  if (!convert) return micros;
  const asBigInt = BigInt(micros);
  const million = BigInt(1_000_000);
  const whole = asBigInt / million;
  const remainder = asBigInt % million;
  const value = Number(whole) + Number(remainder) / 1_000_000;
  const converted = convert(value, sourceCurrency);
  return String(BigInt(Math.round(converted * 1_000_000)));
}

/** Catmull-Rom spline → cubic Bezier. Smooth curve through all points. */
function splinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  if (points.length === 2) {
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;
  }

  const segs: string[] = [`M ${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    segs.push(
      `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    );
  }

  return segs.join(' ');
}
