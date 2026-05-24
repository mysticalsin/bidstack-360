// Shared chart color tokens that read from CSS variables so they
// automatically swap in dark mode. Recharts consumes these as fill/stroke
// strings — the variables are defined in index.css.
//
// Usage: import CHART_COLORS from '@/components/charts/chartTokens';
// then use CHART_COLORS[0], CHART_COLORS[1], … in Recharts cells/lines.

export const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
] as const;

export const CHART_GRID_COLOR = 'var(--border-subtle)';
export const CHART_AXIS_COLOR = 'var(--fg-tertiary)';
export const CHART_TOOLTIP_BG = 'var(--surface-card)';
export const CHART_TOOLTIP_BORDER = 'var(--border-default)';
export const CHART_TOOLTIP_FG = 'var(--fg-primary)';
