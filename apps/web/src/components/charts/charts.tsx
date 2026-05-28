// All Recharts-based chart components in one file to keep the bundle chunked together.
// Each component supports dark mode via CSS variable tokens and has ARIA attributes
// + a data-table fallback for screen readers.
//
// Import individual named exports: LineChart, BarChart, etc.

import { motion, useReducedMotion } from 'framer-motion';
import {
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart as RPieChart,
  Radar as RRadar,
  RadarChart as RRadarChart,
  PolarAngleAxis,
  PolarGrid,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart as RScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  Line,
  LineChart as RLineChart,
  Bar,
  BarChart as RBarChart,
  Area,
  AreaChart as RAreaChart,
  ReferenceLine,
} from 'recharts';

import {
  CHART_COLORS,
  CHART_GRID_COLOR,
  CHART_AXIS_COLOR,
  CHART_TOOLTIP_BG,
  CHART_TOOLTIP_BORDER,
  CHART_TOOLTIP_FG,
} from './chartTokens';

// ── Shared types ─────────────────────────────────────────────────────────────

type DataPoint = Record<string, unknown>;

interface BaseProps {
  data: DataPoint[];
  xKey: string;
  yKey: string | string[];
  'aria-label'?: string;
  height?: number;
}

// ── Tooltip style ─────────────────────────────────────────────────────────────

const tooltipStyle = {
  backgroundColor: CHART_TOOLTIP_BG,
  border: `1px solid ${CHART_TOOLTIP_BORDER}`,
  borderRadius: '8px',
  color: CHART_TOOLTIP_FG,
  fontSize: '12px',
  padding: '8px 12px',
};

const axisProps = {
  tick: { fill: CHART_AXIS_COLOR, fontSize: 11 },
  axisLine: { stroke: CHART_GRID_COLOR },
  tickLine: { stroke: CHART_GRID_COLOR },
};

// ── ScreenReader data table (WCAG fallback) ───────────────────────────────────

function DataTable({ data, xKey, yKeys }: { data: DataPoint[]; xKey: string; yKeys: string[] }) {
  if (data.length === 0) return null;
  return (
    <div className="sr-only">
      <table>
        <thead>
          <tr>
            <th scope="col">{xKey}</th>
            {yKeys.map((k) => (
              <th key={k} scope="col">
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              <td>{String(row[xKey] ?? '')}</td>
              {yKeys.map((k) => (
                <td key={k}>{String(row[k] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function resolveYKeys(yKey: string | string[]): string[] {
  return Array.isArray(yKey) ? yKey : [yKey];
}

// ── Entrance animation wrapper ────────────────────────────────────────────────

function ChartEnter({ children, height }: { children: React.ReactNode; height: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      style={{ height }}
    >
      {children}
    </motion.div>
  );
}

// ── LineChart ─────────────────────────────────────────────────────────────────

export function LineChart({ data, xKey, yKey, 'aria-label': ariaLabel, height = 240 }: BaseProps) {
  const yKeys = resolveYKeys(yKey);
  return (
    <div role="img" aria-label={ariaLabel ?? 'Line chart'}>
      <DataTable data={data} xKey={xKey} yKeys={yKeys} />
      <ChartEnter height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <RLineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12, color: CHART_AXIS_COLOR }} />
            {yKeys.map((k, i) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </RLineChart>
        </ResponsiveContainer>
      </ChartEnter>
    </div>
  );
}

// ── BarChart ──────────────────────────────────────────────────────────────────

export function BarChart({
  data,
  xKey,
  yKey,
  'aria-label': ariaLabel,
  height = 240,
  stacked = false,
}: BaseProps & { stacked?: boolean }) {
  const yKeys = resolveYKeys(yKey);
  return (
    <div role="img" aria-label={ariaLabel ?? 'Bar chart'}>
      <DataTable data={data} xKey={xKey} yKeys={yKeys} />
      <ChartEnter height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <RBarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12, color: CHART_AXIS_COLOR }} />
            {yKeys.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                stackId={stacked ? 'stack' : undefined}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
                radius={[3, 3, 0, 0]}
              />
            ))}
          </RBarChart>
        </ResponsiveContainer>
      </ChartEnter>
    </div>
  );
}

// ── AreaChart ─────────────────────────────────────────────────────────────────

export function AreaChart({ data, xKey, yKey, 'aria-label': ariaLabel, height = 240 }: BaseProps) {
  const yKeys = resolveYKeys(yKey);
  return (
    <div role="img" aria-label={ariaLabel ?? 'Area chart'}>
      <DataTable data={data} xKey={xKey} yKeys={yKeys} />
      <ChartEnter height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <RAreaChart data={data}>
            <defs>
              {yKeys.map((k, i) => (
                <linearGradient key={k} id={`grad-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={CHART_COLORS[i % CHART_COLORS.length]}
                    stopOpacity={0.28}
                  />
                  <stop
                    offset="100%"
                    stopColor={CHART_COLORS[i % CHART_COLORS.length]}
                    stopOpacity={0.02}
                  />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12, color: CHART_AXIS_COLOR }} />
            {yKeys.map((k, i) => (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                fill={`url(#grad-${k})`}
                strokeWidth={2}
              />
            ))}
          </RAreaChart>
        </ResponsiveContainer>
      </ChartEnter>
    </div>
  );
}

// ── PieChart ──────────────────────────────────────────────────────────────────

interface PieProps {
  data: { name: string; value: number }[];
  'aria-label'?: string;
  height?: number;
}

export function PieChart({ data, 'aria-label': ariaLabel, height = 240 }: PieProps) {
  const reduced = useReducedMotion();
  return (
    <div role="img" aria-label={ariaLabel ?? 'Pie chart'}>
      <div className="sr-only">
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.name}>
                <td>{d.name}</td>
                <td>{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ChartEnter height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <RPieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              outerRadius="70%"
              dataKey="value"
              isAnimationActive={!reduced}
              animationDuration={600}
            >
              {data.map((_entry, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12, color: CHART_AXIS_COLOR }} />
          </RPieChart>
        </ResponsiveContainer>
      </ChartEnter>
    </div>
  );
}

// ── DonutChart ────────────────────────────────────────────────────────────────

export function DonutChart({ data, 'aria-label': ariaLabel, height = 240 }: PieProps) {
  const reduced = useReducedMotion();
  return (
    <div role="img" aria-label={ariaLabel ?? 'Donut chart'}>
      <div className="sr-only">
        <ul>
          {data.map((d) => (
            <li key={d.name}>
              {d.name}: {d.value}
            </li>
          ))}
        </ul>
      </div>
      <ChartEnter height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <RPieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius="40%"
              outerRadius="70%"
              dataKey="value"
              isAnimationActive={!reduced}
              animationDuration={600}
            >
              {data.map((_entry, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12, color: CHART_AXIS_COLOR }} />
          </RPieChart>
        </ResponsiveContainer>
      </ChartEnter>
    </div>
  );
}

// ── FunnelChart (horizontal bar with funnel semantics) ────────────────────────

interface FunnelProps {
  data: { name: string; value: number }[];
  'aria-label'?: string;
  height?: number;
}

export function FunnelChart({ data, 'aria-label': ariaLabel, height = 240 }: FunnelProps) {
  // Render as a horizontal stacked bar chart descending — true funnel requires
  // recharts-funnel-chart or a custom shape; use horizontal bars sorted desc
  // as a standards-compliant approximation without extra deps.
  const sorted = [...data].sort((a, b) => b.value - a.value);
  return (
    <div role="img" aria-label={ariaLabel ?? 'Funnel chart'}>
      <div className="sr-only">
        <ol>
          {sorted.map((d) => (
            <li key={d.name}>
              {d.name}: {d.value}
            </li>
          ))}
        </ol>
      </div>
      <ChartEnter height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <RBarChart data={sorted} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} horizontal={false} />
            <XAxis type="number" {...axisProps} />
            <YAxis type="category" dataKey="name" {...axisProps} width={90} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {sorted.map((_entry, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </RBarChart>
        </ResponsiveContainer>
      </ChartEnter>
    </div>
  );
}

// ── GaugeChart (radial bar showing single metric 0-100%) ──────────────────────

interface GaugeProps {
  value: number; // 0-100
  label: string;
  'aria-label'?: string;
  height?: number;
}

export function GaugeChart({ value, label, 'aria-label': ariaLabel, height = 200 }: GaugeProps) {
  const reduced = useReducedMotion();
  const data = [{ name: label, value }];
  return (
    <div
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel ?? label}
    >
      <ChartEnter height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%"
            cy="55%"
            innerRadius="60%"
            outerRadius="90%"
            startAngle={180}
            endAngle={0}
            data={data}
          >
            <RadialBar
              dataKey="value"
              cornerRadius={6}
              fill={CHART_COLORS[0]}
              isAnimationActive={!reduced}
              animationDuration={800}
              background={{ fill: CHART_GRID_COLOR }}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <p className="text-center -mt-8 text-2xl font-bold text-[var(--fg-primary)] tabular-nums">
          {value}%
        </p>
        <p className="text-center text-xs text-[var(--fg-tertiary)] mt-1">{label}</p>
      </ChartEnter>
    </div>
  );
}

// ── ScatterChart ──────────────────────────────────────────────────────────────

interface ScatterProps {
  data: { x: number; y: number; name?: string }[];
  xLabel?: string;
  yLabel?: string;
  'aria-label'?: string;
  height?: number;
}

export function ScatterChart({
  data,
  xLabel = 'x',
  yLabel = 'y',
  'aria-label': ariaLabel,
  height = 240,
}: ScatterProps) {
  return (
    <div role="img" aria-label={ariaLabel ?? 'Scatter chart'}>
      <div className="sr-only">
        <table>
          <thead>
            <tr>
              <th scope="col">{xLabel}</th>
              <th scope="col">{yLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={i}>
                <td>{d.x}</td>
                <td>{d.y}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ChartEnter height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <RScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
            <XAxis dataKey="x" name={xLabel} {...axisProps} />
            <YAxis dataKey="y" name={yLabel} {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: '3 3' }} />
            <Scatter data={data} fill={CHART_COLORS[0]} opacity={0.8} />
          </RScatterChart>
        </ResponsiveContainer>
      </ChartEnter>
    </div>
  );
}

// ── RadarChart ────────────────────────────────────────────────────────────────

interface RadarProps {
  data: DataPoint[];
  keys: string[];
  nameKey?: string;
  'aria-label'?: string;
  height?: number;
}

export function RadarChart({
  data,
  keys,
  nameKey = 'subject',
  'aria-label': ariaLabel,
  height = 240,
}: RadarProps) {
  const reduced = useReducedMotion();
  return (
    <div role="img" aria-label={ariaLabel ?? 'Radar chart'}>
      <DataTable data={data} xKey={nameKey} yKeys={keys} />
      <ChartEnter height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <RRadarChart data={data}>
            <PolarGrid stroke={CHART_GRID_COLOR} />
            <PolarAngleAxis dataKey={nameKey} tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }} />
            {keys.map((k, i) => (
              <RRadar
                key={k}
                name={k}
                dataKey={k}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
                fillOpacity={0.18}
                isAnimationActive={!reduced}
              />
            ))}
            <Legend wrapperStyle={{ fontSize: 12, color: CHART_AXIS_COLOR }} />
            <Tooltip contentStyle={tooltipStyle} />
          </RRadarChart>
        </ResponsiveContainer>
      </ChartEnter>
    </div>
  );
}

// ── HeatmapChart (calendar-style, 7-column grid) ─────────────────────────────

interface HeatmapProps {
  data: { label: string; value: number }[];
  columns?: number;
  'aria-label'?: string;
  maxValue?: number;
}

export function HeatmapChart({
  data,
  columns = 7,
  'aria-label': ariaLabel,
  maxValue,
}: HeatmapProps) {
  const max = maxValue ?? Math.max(...data.map((d) => d.value), 1);
  return (
    <div
      role="img"
      aria-label={ariaLabel ?? 'Heatmap'}
      className="flex flex-wrap gap-1"
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
    >
      <div className="sr-only">
        <ul>
          {data.map((d) => (
            <li key={d.label}>
              {d.label}: {d.value}
            </li>
          ))}
        </ul>
      </div>
      {data.map((d) => {
        const intensity = d.value / max;
        return (
          <div
            key={d.label}
            title={`${d.label}: ${d.value}`}
            aria-label={`${d.label}: ${d.value}`}
            className="w-4 h-4 rounded-sm transition-opacity"
            style={{
              backgroundColor: `color-mix(in srgb, var(--chart-1) ${Math.round(intensity * 100)}%, var(--border-subtle))`,
            }}
          />
        );
      })}
    </div>
  );
}

// ── TableChart ────────────────────────────────────────────────────────────────

interface TableChartProps {
  data: DataPoint[];
  columns?: { key: string; label: string }[];
  'aria-label'?: string;
}

export function TableChart({ data, columns, 'aria-label': ariaLabel }: TableChartProps) {
  const cols = columns ?? (data[0] ? Object.keys(data[0]).map((k) => ({ key: k, label: k })) : []);
  if (data.length === 0) {
    return (
      <p className="text-xs text-[var(--fg-tertiary)] py-4 text-center">No rows to display.</p>
    );
  }
  return (
    <div
      className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]"
      role="region"
      aria-label={ariaLabel ?? 'Data table'}
    >
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
            {cols.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="px-3 py-2 text-left font-semibold text-[var(--fg-secondary)] uppercase tracking-wide"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={i}
              className={i % 2 === 0 ? 'bg-[var(--surface-card)]' : 'bg-[var(--surface-sunken)]'}
            >
              {cols.map((c) => (
                <td key={c.key} className="px-3 py-2 text-[var(--fg-primary)]">
                  {String(row[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Re-export the reference line for consumers who need it (e.g. trend lines)
export { ReferenceLine };
