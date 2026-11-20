// TUFFUI (https://tuffui.com) · MIT License · Copyright (c) 2026 TUFFUI contributors
// Vendored from registry/stat-grid/stat-grid.tsx (the inner Sparkline) at commit 378f3eaa (see ./LICENSE).
// Rewrites at import: exported as a standalone component; var(--positive) -> var(--success);
// var(--negative) -> var(--danger); var(--muted-foreground) -> var(--fg-tertiary);
// motion.path / motion.circle -> static path / circle (one per table row, no tween);
// single-point and empty series guarded; optional accessible label added.
import { useId } from 'react';

const toneColor = {
  positive: 'var(--success)',
  negative: 'var(--danger)',
  neutral: 'var(--fg-tertiary)',
};

export type SparklineTone = keyof typeof toneColor;

/** Tiny trend line; the last point is marked so "now" is easy to find. */
export function Sparkline({
  values,
  tone,
  label,
}: {
  values: number[];
  tone: SparklineTone;
  label?: string;
}) {
  const id = useId().replace(/:/g, '');
  const w = 72;
  const h = 28;
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pts = values.map(
    (v, i) =>
      [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / span) * (h - 6)] as const,
  );
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const [lx, ly] = pts[pts.length - 1]!;
  const color = toneColor[tone];

  return (
    <svg
      width={w}
      height={h}
      className="shrink-0 overflow-visible"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d}L${pts.at(-1)![0]},${h}L${pts[0]![0]},${h}Z`} fill={`url(#${id})`} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lx} cy={ly} r={2.5} fill={color} />
    </svg>
  );
}
