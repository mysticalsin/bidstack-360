// Inline SVG sparkline — no dependency, no canvas. Draws a smoothed line
// across an array of values, scaled to the available width. Used inside
// KPI tiles to give each metric a "this is the trend" glance.
//
// We don't synthesize random data: callers pass real (or seeded fake)
// values. For mock points we use a deterministic hash of the KPI label
// so the same label always shows the same shape between renders.

interface Props {
  values: number[];
  width?: number;
  height?: number;
  /** Stroke color. Defaults to currentColor so it inherits the tile tone. */
  color?: string;
  /** Fill opacity beneath the line. 0 = no fill. */
  fillOpacity?: number;
}

export function Sparkline({
  values,
  width = 56,
  height = 16,
  color = 'currentColor',
  fillOpacity = 0.18,
}: Props) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  // Map each value to an (x, y) inside the box, with a 1px inset so the
  // top and bottom of the curve don't get clipped by the viewBox edge.
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - 1 - ((v - min) / range) * (height - 2);
    return [x, y] as const;
  });
  const linePath = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ');
  // Closed path for the fill, anchored back to the baseline.
  const last = points[points.length - 1]!;
  const first = points[0]!;
  const fillPath = `${linePath} L ${last[0].toFixed(2)} ${height} L ${first[0].toFixed(2)} ${height} Z`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      style={{ display: 'block' }}
    >
      {fillOpacity > 0 ? <path d={fillPath} fill={color} opacity={fillOpacity} /> : null}
      <path d={linePath} stroke={color} strokeWidth={1.5} fill="none" strokeLinejoin="round" />
    </svg>
  );
}
