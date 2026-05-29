/**
 * CartesianCharts — LineChart, BarChart, AreaChart, FunnelChart, ScatterChart.
 * All render on a Cartesian coordinate system via Recharts.
 */
import {
  Area,
  AreaChart as RAreaChart,
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart as RScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { CHART_COLORS, CHART_GRID_COLOR } from './chartTokens';
import { type BaseProps, axisProps, tooltipStyle, resolveYKeys } from './chartTypes';
import { DataTable, ChartEnter } from './chartShared';

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
            <Legend wrapperStyle={{ fontSize: 12, color: axisProps.tick.fill }} />
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
            <Legend wrapperStyle={{ fontSize: 12, color: axisProps.tick.fill }} />
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
            <Legend wrapperStyle={{ fontSize: 12, color: axisProps.tick.fill }} />
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

// ── FunnelChart ───────────────────────────────────────────────────────────────

interface FunnelProps {
  data: { name: string; value: number }[];
  'aria-label'?: string;
  height?: number;
}

export function FunnelChart({ data, 'aria-label': ariaLabel, height = 240 }: FunnelProps) {
  // Horizontal bar chart sorted descending — true funnel semantics without
  // adding recharts-funnel-chart as an extra dep.
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
