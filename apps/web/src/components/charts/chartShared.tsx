/**
 * chartShared — shared types, style constants, and private helper components
 * used across all chart variants. Not part of the public charts API.
 */
import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import {
  CHART_GRID_COLOR,
  CHART_AXIS_COLOR,
  CHART_TOOLTIP_BG,
  CHART_TOOLTIP_BORDER,
  CHART_TOOLTIP_FG,
} from './chartTokens';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DataPoint = Record<string, unknown>;

export interface BaseProps {
  data: DataPoint[];
  xKey: string;
  yKey: string | string[];
  'aria-label'?: string;
  height?: number;
}

// ── Style constants ───────────────────────────────────────────────────────────

export const tooltipStyle = {
  backgroundColor: CHART_TOOLTIP_BG,
  border: `1px solid ${CHART_TOOLTIP_BORDER}`,
  borderRadius: '8px',
  color: CHART_TOOLTIP_FG,
  fontSize: '12px',
  padding: '8px 12px',
};

export const axisProps = {
  tick: { fill: CHART_AXIS_COLOR, fontSize: 11 },
  axisLine: { stroke: CHART_GRID_COLOR },
  tickLine: { stroke: CHART_GRID_COLOR },
};

// ── Utility ───────────────────────────────────────────────────────────────────

export function resolveYKeys(yKey: string | string[]): string[] {
  return Array.isArray(yKey) ? yKey : [yKey];
}

// ── DataTable — sr-only accessible fallback for Recharts visualisations ───────

export function DataTable({
  data,
  xKey,
  yKeys,
}: {
  data: DataPoint[];
  xKey: string;
  yKeys: string[];
}) {
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

// ── ChartEnter — framer-motion entrance animation wrapper ─────────────────────

export function ChartEnter({ children, height }: { children: ReactNode; height: number }) {
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
