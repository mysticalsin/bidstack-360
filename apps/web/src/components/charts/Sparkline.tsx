// Minimal sparkline — a tiny SVG line chart for KPI tiles.
// No axes, no labels, just a smooth trend line that gives immediate
// visual context to the number above it.

import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

interface Props {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
}

export function Sparkline({
  data,
  width = 120,
  height = 32,
  stroke = 'var(--brand-primary)',
  strokeWidth = 1.5,
  fill = 'var(--brand-primary-tint)',
}: Props) {
  const reducedMotion = useReducedMotion();

  const paths = useMemo(() => {
    if (data.length < 2) return null;
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const stepX = width / (data.length - 1);
    const points = data.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return { x, y };
    });
    const line = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
    const area = `${line} L ${points[points.length - 1]!.x.toFixed(1)} ${height} L ${points[0]!.x.toFixed(1)} ${height} Z`;
    return { line, area };
  }, [data, width, height]);

  if (!paths) return null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block w-full"
      style={{ height }}
      aria-hidden="true"
    >
      <motion.path
        d={paths.area}
        fill={fill}
        fillOpacity={0.3}
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      />
      <motion.path
        d={paths.line}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reducedMotion ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
    </svg>
  );
}
