// Pure utility functions for the SalesIntelligencePanel — no React, no JSX.
import type { MonthlySalesPoint, SalesIntelligenceReport } from '@bidstack/shared';

import { formatMoney } from '@/lib/format';

/** Derives all SVG geometry data for the monthly sales area chart. */
export function chartGeometry(points: MonthlySalesPoint[]) {
  if (points.length === 0) return null;
  const width = 720;
  const height = 220;
  const pad = 30;
  const max = Math.max(...points.map((point) => point.revenueMicros), 1);
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((point, index) => ({
    x: pad + index * step,
    y: height - pad - (point.revenueMicros / max) * (height - pad * 2),
    label: point.month,
  }));
  const linePoints = coords.map((point) => `${point.x},${point.y}`).join(' ');
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (!first || !last) return null;
  const areaPath = `M ${first.x} ${height - pad} L ${linePoints.replaceAll(' ', ' L ')} L ${last.x} ${height - pad} Z`;
  const grid = [0.2, 0.4, 0.6, 0.8].map((n) => pad + (height - pad * 2) * n);
  return { width, height, pad, points: coords, linePoints, areaPath, grid };
}

/** Converts a micros amount to a display currency string. */
export function formatMicros(micros: number, currencyCode: string): string {
  return formatMoney(micros / 1_000_000, currencyCode);
}

/** Compact notation (e.g. "EUR1.2M") for KPI tiles and axis labels. */
export function formatCompactMicros(micros: number, currencyCode: string): string {
  const value = micros / 1_000_000;
  const formatted = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
  return `${currencyCode}${formatted}`;
}

/** Formats a percentage change with sign prefix. */
export function formatTrend(percent: number): string {
  if (percent === 0) return '0.0%';
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(1)}%`;
}

/** Returns the human-readable data source caption for the monthly chart header. */
export function sourceCaption(report: SalesIntelligenceReport): string {
  return report.sourceAttribution[0]?.label ?? 'BidStack sales intelligence';
}

/** Proportional share (0–100) of value relative to max. */
export function share(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round((value / max) * 100);
}
