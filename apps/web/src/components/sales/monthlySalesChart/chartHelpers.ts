// Pure math/geometry helpers for MonthlySalesChart — no React, no hooks.

export const MARGIN = { top: 20, right: 16, bottom: 36, left: 56 } as const;

export function niceCeil(value: number): number {
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

export function formatYTick(value: number): string {
  if (value >= 1_000_000_000)
    return `${(value / 1_000_000_000).toFixed(value % 1_000_000_000 === 0 ? 0 : 1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
  if (value === 0) return '0';
  return value.toLocaleString('en-US');
}

export function getTooltipFrame(
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

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function convertedMicros(
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
export function splinePath(points: Array<{ x: number; y: number }>): string {
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
