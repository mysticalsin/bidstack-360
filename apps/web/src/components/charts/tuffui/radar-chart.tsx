// TUFFUI (https://tuffui.com) · MIT License · Copyright (c) 2026 TUFFUI contributors
// Vendored from registry/radar-chart/radar-chart.tsx at commit 378f3eaa (see ./LICENSE).
// Rewrites at import: Shell/Panel/ShellHeader and the Phosphor icon removed
// (the caller owns the card and heading), members dropped (a bid has one
// score), the grain pattern and its useId dropped, @/lib/utils to @/lib/cn,
// shadcn colour classes swapped for Polo tokens, brand to --brand-deep,
// onSelect fires on click and Enter only, named axis hit areas, empty state.

import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { EASE_OUT, enter, exit } from '@/lib/motion-tokens';

export type RadarSeries = {
  id: string;
  label: string;
  /** One value per axis, on the `0…max` scale. */
  values: number[];
  /** Any CSS color. Defaults to the brand color. */
  color?: string;
};

export type RadarChartProps = {
  /** One label per axis, clockwise from the top. Five to ten read best. */
  axes: string[];
  /** Top of the scale; the outer ring. */
  max: number;
  /** The filled polygon. */
  series: RadarSeries;
  /** A dashed polygon to measure against, e.g. the go threshold. */
  baseline?: { label: string; values: number[] };
  /** Used for the accessible names; the caller draws the visible heading. */
  title: string;
  format?: (value: number) => string;
  /** Called when an axis is clicked, or reached with the arrow keys and Enter pressed. */
  onSelect?: (axis: number) => void;
  /** Shown instead of the chart when there are no axes. */
  empty?: ReactNode;
  className?: string;
};

const GAP = 12;
const LINE = 16;
const PAD = 6;
const MAX_R = 124;
const MIN_R = 48;
const TIP = 196;

const round = (n: number) => Math.round(n * 100) / 100;

// Rough text widths at 12px, so labels can be fitted before they render.
const sansW = (s: string) => s.length * 6.3;
const WRAP = 84;
const monoW = (s: string) => s.length * 7.3;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  // null until measured: the chart draws once at its real width, so entrance
  // animations don't tween from a guessed size.
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width || null);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width ?? 400, width !== null] as const;
}

/**
 * A polygon over a handful of axes on a fixed scale: one filled series and an
 * optional dashed bar to beat.
 */
export function RadarChart({
  axes,
  max,
  series,
  baseline,
  title,
  format = (v) => v.toFixed(1),
  onSelect,
  empty,
  className,
}: RadarChartProps) {
  const reduce = useReducedMotion();
  const [ref, width, measured] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const [fromKeyboard, setFromKeyboard] = useState(false);

  const n = axes.length;
  if (!n) {
    return <p className={cn('py-6 text-center text-sm text-fg-secondary', className)}>{empty ?? 'Nothing scored yet.'}</p>;
  }

  const brand = series.color ?? 'var(--brand-deep)';
  const angles = axes.map((_, i) => {
    const a = (i / Math.max(n, 1)) * 2 * Math.PI;
    return { dx: Math.sin(a), dy: -Math.cos(a) };
  });
  const values = axes.map((_, i) => format(series.values[i] ?? 0));

  // Narrow cards wrap names by word and put the value on its own line.
  const wrapped = axes.map((label) =>
    label.split(' ').reduce<string[]>((acc, word) => {
      const last = acc[acc.length - 1];
      if (last && sansW(`${last} ${word}`) <= WRAP) acc[acc.length - 1] = `${last} ${word}`;
      else acc.push(word);
      return acc;
    }, []),
  );

  // Fit the radius so every label stays inside the card.
  const fit = (stacked: boolean) =>
    Math.min(
      MAX_R,
      ...angles.map(({ dx }, i) => {
        const w = stacked
          ? Math.max(...wrapped[i]!.map(sansW), monoW(values[i]!))
          : sansW(axes[i]!) + 4 + monoW(values[i]!);
        if (Math.abs(dx) < 0.15) return (width / 2 - PAD) * 2 >= w ? MAX_R : MIN_R;
        return (width / 2 - w - PAD) / Math.abs(dx) - GAP;
      }),
    );
  const stacked = fit(false) < 96 && fit(true) > fit(false);
  const R = Math.max(MIN_R, Math.floor(fit(stacked)));
  const lines = axes.map((_, i) => (stacked ? wrapped[i]!.length + 1 : 1));

  // Vertical room each label needs past the polygon, above and below.
  const reach = (side: 1 | -1) =>
    Math.max(
      R,
      ...angles.map(({ dx, dy }, i) => {
        const d = (R + GAP) * dy * side;
        return Math.abs(dx) < 0.15 ? d + (d > 0 ? lines[i]! * LINE : 0) : d + (lines[i]! * LINE) / 2;
      }),
    );
  const top = reach(-1) + PAD;
  const height = Math.ceil(top + reach(1) + PAD);
  const cx = round(width / 2);
  const cy = round(top);

  const at = (i: number, r: number) => [round(cx + r * angles[i]!.dx), round(cy + r * angles[i]!.dy)] as const;
  const scale = (v: number) => (Math.min(Math.max(v, 0), max) / max) * R;
  const shape = (vals: number[], k = 1) =>
    axes
      .map((_, i) => {
        const [x, y] = at(i, scale(vals[i] ?? 0) * k);
        return `${i ? 'L' : 'M'}${x} ${y}`;
      })
      .join('') + 'Z';
  const ring = (r: number) => shape(axes.map(() => r));

  const steps = Number.isInteger(max) && max <= 10 ? max : 4;
  const rings = Array.from({ length: steps }, (_, k) => ((k + 1) / steps) * max);

  const select = (index: number | null, keyboard: boolean) => {
    setFromKeyboard(keyboard);
    setActive(index);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.key === 'Enter' || event.key === ' ') && active !== null) {
      event.preventDefault();
      onSelect?.(active);
      return;
    }
    const keys: Record<string, number> = {
      ArrowRight: (active ?? -1) + 1,
      ArrowDown: (active ?? -1) + 1,
      ArrowLeft: (active ?? n) - 1,
      ArrowUp: (active ?? n) - 1,
      Home: 0,
      End: n - 1,
    };
    if (event.key === 'Escape') return select(null, true);
    if (!(event.key in keys)) return;
    event.preventDefault();
    select((keys[event.key]! + n) % n, true);
  };

  const wedge = (i: number) => {
    const far = R + GAP + 160;
    const half = Math.PI / Math.max(n, 1);
    const a = (i / Math.max(n, 1)) * 2 * Math.PI;
    const p = (t: number) => `${round(cx + far * Math.sin(t))} ${round(cy - far * Math.cos(t))}`;
    return `M${cx} ${cy}L${p(a - half)}L${p(a)}L${p(a + half)}Z`;
  };

  const best = axes[series.values.indexOf(Math.max(...series.values.slice(0, n)))] ?? '';
  const tip = active === null ? null : at(active, scale(series.values[active] ?? 0));
  const axisText = (i: number) =>
    `${axes[i]}: ${values[i]}${baseline ? `, ${baseline.label} ${format(baseline.values[i] ?? 0)}` : ''}`;

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn('w-full', className)}>
        <div
          ref={ref}
          tabIndex={0}
          role="group"
          aria-label={`${title}. Use arrow keys to read each axis.`}
          onKeyDown={onKeyDown}
          onBlur={() => fromKeyboard && setActive(null)}
          className="relative rounded-xl outline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
        >
          <svg
            key={measured ? 'measured' : 'guess'}
            visibility={measured ? undefined : 'hidden'}
            role="img"
            aria-label={`${title}: ${series.label} ${axes.map((a, i) => `${a} ${values[i]}`).join(', ')}. Strongest on ${best}.`}
            width={width}
            height={height}
            className="block overflow-visible"
            onPointerLeave={() => select(null, false)}
          >
            <path d={ring(max)} style={{ fill: 'var(--surface-hover)' }} fillOpacity={0.5} />
            {rings.map((r) => (
              <path key={r} d={ring(r)} fill="none" stroke="var(--fg-tertiary)" strokeOpacity={0.2} strokeLinejoin="round" />
            ))}
            {axes.map((_, i) => {
              const [x, y] = at(i, R);
              return (
                <line
                  key={i}
                  x1={cx}
                  y1={cy}
                  x2={x}
                  y2={y}
                  stroke="var(--fg-tertiary)"
                  strokeOpacity={active === i ? 0.6 : 0.2}
                  className={cn('transition-[stroke-opacity] duration-150', fromKeyboard && 'duration-0')}
                />
              );
            })}

            {baseline && (
              <path
                d={shape(baseline.values)}
                fill="none"
                stroke="var(--fg-secondary)"
                strokeOpacity={0.7}
                strokeWidth={1.25}
                strokeDasharray="4 4"
                strokeLinejoin="round"
              />
            )}

            <motion.path
              initial={{ d: shape(series.values, 0.9), opacity: 0 }}
              animate={{ d: shape(series.values), opacity: 1 }}
              transition={{ duration: 0.3, ease: EASE_OUT }}
              style={{ fill: brand, stroke: brand }}
              fillOpacity={0.2}
              strokeWidth={1.75}
              strokeLinejoin="round"
            />

            <motion.g
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25, ease: EASE_OUT, delay: reduce ? 0 : 0.15 }}
            >
              {axes.map((_, i) => {
                const [x, y] = at(i, scale(series.values[i] ?? 0));
                return active === i ? (
                  <circle key={i} cx={x} cy={y} r={5} className="fill-fg-primary" />
                ) : (
                  <circle key={i} cx={x} cy={y} r={3.5} style={{ fill: brand }} />
                );
              })}
            </motion.g>

            {axes.map((label, i) => {
              const { dx, dy } = angles[i]!;
              const [x, y] = at(i, R + GAP);
              const middle = Math.abs(dx) < 0.15;
              const anchor = middle ? 'middle' : dx > 0 ? 'start' : 'end';
              // Top labels grow upward, bottom ones downward, side ones center.
              const first = middle ? (dy < 0 ? -(lines[i]! - 1) * LINE : LINE * 0.5) : (-(lines[i]! - 1) * LINE) / 2;
              const on = active === i;
              return (
                <text
                  key={i}
                  x={x}
                  y={round(y + first)}
                  dy={middle && dy < 0 ? 0 : '0.32em'}
                  textAnchor={anchor}
                  fontSize="12"
                  className={cn(
                    'transition-[fill] duration-150',
                    on ? 'fill-fg-primary' : 'fill-fg-secondary',
                    fromKeyboard && 'duration-0',
                  )}
                >
                  {stacked
                    ? wrapped[i]!.map((line, k) => (
                        <tspan key={k} x={x} dy={k ? LINE : undefined}>
                          {line}
                        </tspan>
                      ))
                    : label}
                  <tspan
                    {...(stacked ? { x, dy: LINE } : { dx: 4 })}
                    className={cn('font-mono tabular-nums', on ? 'fill-fg-primary' : 'fill-fg-secondary')}
                  >
                    {values[i]}
                  </tspan>
                </text>
              );
            })}

            {axes.map((_, i) => (
              <path
                key={i}
                role="graphics-symbol"
                aria-label={axisText(i)}
                d={wedge(i)}
                fill="transparent"
                className={onSelect ? 'cursor-pointer' : undefined}
                onPointerEnter={() => select(i, false)}
                onClick={() => {
                  select(i, false);
                  onSelect?.(i);
                }}
              />
            ))}
          </svg>

          <AnimatePresence>
            {active !== null && tip && (
              <motion.div
                key="tip"
                initial={fromKeyboard ? false : { opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1, transition: enter }}
                exit={{ opacity: 0, transition: exit }}
                className="pointer-events-none absolute z-10 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-2 text-xs shadow-[var(--shadow-md)]"
                style={{
                  width: Math.min(TIP, width),
                  left: Math.min(Math.max(tip[0] - TIP / 2, 0), Math.max(width - TIP, 0)),
                  // Below the vertex on the top half, above it on the bottom.
                  ...(tip[1] <= cy
                    ? { top: tip[1] + 12, transformOrigin: 'top center' }
                    : { bottom: height - tip[1] + 12, transformOrigin: 'bottom center' }),
                }}
              >
                <p className="flex gap-3 text-fg-primary">
                  <span className="flex-1 font-medium">{axes[active]}</span>
                  <span className="font-mono tabular-nums">{values[active]}</span>
                </p>
                {baseline && (
                  <p className="mt-1 flex gap-3 text-fg-secondary">
                    <span className="flex-1">{baseline.label}</span>
                    <span className="font-mono tabular-nums">{format(baseline.values[active] ?? 0)}</span>
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-fg-secondary">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ background: brand }} />
            {series.label}
          </span>
          {baseline && (
            <span className="flex items-center gap-1.5">
              <svg aria-hidden="true" width={12} height={2} className="overflow-visible">
                <line x1={0} y1={1} x2={12} y2={1} stroke="var(--fg-secondary)" strokeWidth={1.25} strokeDasharray="3 2" />
              </svg>
              {baseline.label}
            </span>
          )}
        </div>

        <table className="sr-only">
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">Axis</th>
              <th scope="col">{series.label}</th>
              {baseline && <th scope="col">{baseline.label}</th>}
            </tr>
          </thead>
          <tbody>
            {axes.map((axis, i) => (
              <tr key={axis}>
                <th scope="row">{axis}</th>
                <td>{values[i]}</td>
                {baseline && <td>{format(baseline.values[i] ?? 0)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <p role="status" aria-live="polite" className="sr-only">
          {fromKeyboard && active !== null ? axisText(active) : ''}
        </p>
      </div>
    </MotionConfig>
  );
}
