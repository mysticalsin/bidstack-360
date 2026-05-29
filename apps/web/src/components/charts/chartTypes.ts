/**
 * chartTypes — shared types, style constants, and pure utilities used across
 * all chart variants. Lives in a plain .ts file (no JSX) so that
 * react-refresh/only-export-components doesn't fire when these values are
 * re-used alongside React components in .tsx siblings.
 */
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
