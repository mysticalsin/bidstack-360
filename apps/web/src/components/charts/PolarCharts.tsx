/**
 * PolarCharts — PieChart, DonutChart, RadarChart, GaugeChart.
 * All use polar / radial coordinate systems via Recharts.
 */
import { useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  Cell,
  Legend,
  Pie,
  PieChart as RPieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar as RRadar,
  RadarChart as RRadarChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

import { CHART_COLORS, CHART_AXIS_COLOR, CHART_GRID_COLOR } from './chartTokens';
import { type DataPoint, tooltipStyle } from './chartTypes';
import { DataTable, ChartEnter } from './chartShared';

// ── PieChart ──────────────────────────────────────────────────────────────────

interface PieProps {
  data: { name: string; value: number }[];
  'aria-label'?: string;
  height?: number;
}

export function PieChart({ data, 'aria-label': ariaLabel, height = 240 }: PieProps) {
  const reduced = useReducedMotion();
  const { t } = useTranslation('crm');
  return (
    <div role="img" aria-label={ariaLabel ?? t('polarCharts.pieChartAriaLabel', 'Pie chart')}>
      <div className="sr-only">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('polarCharts.columnName', 'Name')}</th>
              <th scope="col">{t('polarCharts.columnValue', 'Value')}</th>
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
  const { t } = useTranslation('crm');
  return (
    <div role="img" aria-label={ariaLabel ?? t('polarCharts.donutChartAriaLabel', 'Donut chart')}>
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
  const { t } = useTranslation('crm');
  return (
    <div role="img" aria-label={ariaLabel ?? t('polarCharts.radarChartAriaLabel', 'Radar chart')}>
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

// ── GaugeChart ────────────────────────────────────────────────────────────────

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
            {/* Fixed 0-100 domain so the arc fills value/100. Without an explicit
                angle axis Recharts derives the domain from the single datum and
                the bar always renders full regardless of value. */}
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
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
