// TUFFUI (https://tuffui.com) · MIT License · Copyright (c) 2026 TUFFUI contributors
// Vendored from registry/dot-histogram/dot-histogram.tsx at commit 378f3eaa (see ./LICENSE).
// Rewrites at import: Shell/Panel/ShellHeader and the Phosphor icon removed
// (the caller owns the card and heading), @/lib/utils to @/lib/cn, shadcn
// colour classes swapped for Polo tokens (fill-brand to fill-brand-deep,
// fill-negative to fill-danger), geometry rounded to two decimals, onSelect
// fires on click and Enter only, named column hit areas, sr-only table,
// empty state.

import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { EASE_OUT, enter, exit } from '@/lib/motion-tokens';

export type DotHistogramBin = {
  from: number;
  to: number;
  count: number;
  flagged: boolean;
};

export type DotHistogramProps = {
  /** Raw samples, e.g. one sales cycle per closed bid. */
  values: number[];
  /** Used for the accessible names; the caller draws the visible heading. */
  title: string;
  /** Samples at or above this value are flagged, e.g. an overdue cycle. */
  threshold?: number;
  /** What a flagged sample means, shown in the tooltip and the footer. */
  thresholdLabel?: string;
  /** Number of columns. */
  bins?: number;
  /** What one sample is called, plural: "bids". */
  unit?: string;
  /** Formats axis labels and the tooltip. */
  format?: (value: number) => string;
  /** Called when a filled column is clicked, or reached with the arrow keys and Enter pressed. */
  onSelect?: (bin: DotHistogramBin) => void;
  /** Shown instead of the chart when there are no samples. */
  empty?: ReactNode;
  className?: string;
};

const STEP = 7;
const R = 2.4;
const MAX_ROWS = 18;
const AXIS = 22;

// Fixed precision keeps server and client markup identical.
const r2 = (v: number) => Math.round(v * 100) / 100;

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
  return [ref, width ?? 520, width !== null] as const;
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo]! + (sorted[Math.ceil(i)]! - sorted[lo]!) * (i - lo);
}

/**
 * A distribution drawn as dots: every column is a range, every dot a sample
 * (or a fixed group of samples when columns get tall). Dots stack outward from
 * the middle line, so the shape reads like a violin.
 */
export function DotHistogram({
  values,
  title,
  threshold,
  thresholdLabel = 'over limit',
  bins: binCount = 48,
  unit = 'samples',
  format = (v) => `${+v.toFixed(2)}`,
  onSelect,
  empty,
  className,
}: DotHistogramProps) {
  const reduce = useReducedMotion();
  const [ref, width, measured] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const [fromKeyboard, setFromKeyboard] = useState(false);

  if (!values.length) {
    return <p className={cn('py-6 text-center text-sm text-fg-secondary', className)}>{empty ?? `No ${unit} yet.`}</p>;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95);
  const top = Math.max(sorted.at(-1) ?? 1, threshold ? threshold * 1.04 : 0) || 1;
  // Put the threshold on a column edge, so no column is half flagged.
  const size =
    threshold && threshold < top ? threshold / Math.max(1, Math.round((binCount * threshold) / top)) : top / binCount;

  const bins: DotHistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    from: r2(i * size),
    to: r2((i + 1) * size),
    count: 0,
    flagged: threshold !== undefined && i * size >= threshold - size / 1000,
  }));
  for (const v of values) bins[Math.max(0, Math.min(Math.floor(v / size), binCount - 1))]!.count++;

  const peak = Math.max(1, ...bins.map((b) => b.count));
  // Tall columns switch to one dot per group so the chart keeps its height.
  const per = Math.max(1, Math.ceil(peak / MAX_ROWS));
  const rows = Math.ceil(peak / per);
  const plotH = Math.max(rows, 6) * STEP + STEP;
  const mid = plotH / 2;
  const colW = width / binCount;
  const x = (v: number) => r2((v / (binCount * size)) * width);
  const flagged = values.filter((v) => threshold !== undefined && v >= threshold).length;
  const binText = (b: DotHistogramBin) => `${format(b.from)} to ${format(b.to)}: ${b.count} ${unit}`;

  const activeBin = active === null ? null : bins[active]!;

  const select = (index: number | null, keyboard: boolean) => {
    setFromKeyboard(keyboard);
    setActive(index);
  };
  const activate = (index: number) => {
    if (bins[index]!.count) onSelect?.(bins[index]!);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const filled = bins.flatMap((b, i) => (b.count ? [i] : []));
    if (!filled.length) return;
    if ((event.key === 'Enter' || event.key === ' ') && active !== null) {
      event.preventDefault();
      activate(active);
      return;
    }
    const at = active === null ? -1 : filled.indexOf(active);
    const keys: Record<string, number> = {
      ArrowRight: at + 1,
      ArrowLeft: at === -1 ? filled.length - 1 : at - 1,
      Home: 0,
      End: filled.length - 1,
    };
    if (event.key === 'Escape') return select(null, true);
    if (!(event.key in keys)) return;
    event.preventDefault();
    select(filled[(keys[event.key]! + filled.length) % filled.length]!, true);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn('w-full', className)}>
        <div
          ref={ref}
          tabIndex={0}
          role="group"
          aria-label={`${title}. Use arrow keys to read columns${onSelect ? ', Enter to open one' : ''}.`}
          onKeyDown={onKeyDown}
          onBlur={() => fromKeyboard && setActive(null)}
          className="relative rounded-xl outline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
        >
          <svg
            key={measured ? 'measured' : 'guess'}
            visibility={measured ? undefined : 'hidden'}
            role="img"
            aria-label={`${values.length} ${unit}, median ${format(median)}, p95 ${format(p95)}${threshold !== undefined ? `, ${flagged} ${thresholdLabel}` : ''}`}
            width={width}
            height={plotH + AXIS}
            className="block overflow-visible"
            onPointerLeave={() => select(null, false)}
          >
            {[0.25, 0.5, 0.75].map((t) => (
              <line
                key={t}
                x1={r2(width * t)}
                x2={r2(width * t)}
                y1={0}
                y2={plotH}
                stroke="var(--fg-tertiary)"
                strokeOpacity={0.25}
                strokeDasharray="2 4"
              />
            ))}

            {activeBin && (
              <rect
                x={r2(active! * colW)}
                y={0}
                width={r2(colW)}
                height={plotH}
                rx={r2(Math.min(colW / 2, 6))}
                style={{ fill: 'var(--surface-hover)' }}
              />
            )}

            {bins.map((bin, i) => {
              const dots = Math.ceil(bin.count / per);
              const cx = r2((i + 0.5) * colW);
              return (
                <motion.g
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3, ease: EASE_OUT, delay: reduce ? 0 : i * 0.008 }}
                >
                  <g
                    className={cn(
                      'transition-opacity duration-150',
                      bin.flagged ? 'fill-danger' : 'fill-brand-deep',
                      active !== null && active !== i && 'opacity-45',
                      fromKeyboard && 'duration-0',
                    )}
                  >
                    {Array.from({ length: dots }, (_, k) => {
                      const side = k % 2 ? 1 : -1;
                      const ring = Math.ceil(k / 2);
                      return <circle key={k} cx={cx} cy={r2(mid + side * ring * STEP)} r={r2(Math.min(R, colW * 0.38))} />;
                    })}
                  </g>
                </motion.g>
              );
            })}

            <line
              x1={x(median)}
              x2={x(median)}
              y1={2}
              y2={plotH - 2}
              strokeWidth={2}
              strokeLinecap="round"
              stroke="var(--fg-secondary)"
            />
            {threshold !== undefined && (
              <line
                x1={x(threshold)}
                x2={x(threshold)}
                y1={0}
                y2={plotH}
                strokeWidth={1.5}
                strokeDasharray="3 3"
                stroke="var(--danger)"
              />
            )}

            <g fontSize="10" className="fill-fg-tertiary">
              <text x={0} y={plotH + 16}>
                {format(0)}
              </text>
              <text x={x(median)} y={plotH + 16} textAnchor="middle" className="fill-fg-primary">
                {format(median)}
              </text>
              {threshold !== undefined && (
                <text x={x(threshold)} y={plotH + 16} textAnchor="end" className="fill-danger">
                  {format(threshold)}
                </text>
              )}
            </g>

            {bins.map((bin, i) => (
              <rect
                key={i}
                role="graphics-symbol"
                aria-label={binText(bin)}
                x={r2(i * colW)}
                y={0}
                width={r2(colW)}
                height={plotH}
                fill="transparent"
                className={bin.count && onSelect ? 'cursor-pointer' : undefined}
                onPointerEnter={() => bin.count && select(i, false)}
                onClick={() => {
                  if (!bin.count) return;
                  select(i, false);
                  activate(i);
                }}
              />
            ))}
          </svg>

          <AnimatePresence>
            {activeBin && (
              <motion.div
                key="tip"
                initial={fromKeyboard ? false : { opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1, transition: enter }}
                exit={{ opacity: 0, transition: exit }}
                className="pointer-events-none absolute top-0 z-10 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-2 text-xs shadow-[var(--shadow-md)]"
                style={{
                  left: Math.min(Math.max((active! + 0.5) * colW + 10, 0), width - 132),
                  transformOrigin: 'top left',
                }}
              >
                <p className="text-fg-secondary">
                  {activeBin.flagged ? thresholdLabel : `${format(activeBin.from)} to ${format(activeBin.to)}`}
                </p>
                <p className="font-mono text-fg-primary tabular-nums">
                  {activeBin.count} {unit} · {((activeBin.count / Math.max(values.length, 1)) * 100).toFixed(1)}%
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-secondary">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-[var(--fg-secondary)]" />
            Median <span className="font-mono text-fg-primary">{format(median)}</span>
          </span>
          <span>
            p95 <span className="font-mono text-fg-primary">{format(p95)}</span>
          </span>
          {threshold !== undefined && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2 rounded-full bg-[var(--danger)]" />
              {thresholdLabel}{' '}
              <span className="font-mono text-fg-primary tabular-nums">
                {flagged} · {((flagged / Math.max(values.length, 1)) * 100).toFixed(1)}%
              </span>
            </span>
          )}
          {per > 1 && (
            <span className="ml-auto">
              1 dot = {per} {unit}
            </span>
          )}
        </div>

        <table className="sr-only">
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">Range</th>
              <th scope="col">{unit.charAt(0).toUpperCase() + unit.slice(1)}</th>
            </tr>
          </thead>
          <tbody>
            {bins
              .filter((b) => b.count)
              .map((b) => (
                <tr key={b.from}>
                  <th scope="row">{`${format(b.from)} to ${format(b.to)}`}</th>
                  <td>{b.count}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <p role="status" aria-live="polite" className="sr-only">
          {fromKeyboard && activeBin ? binText(activeBin) : ''}
        </p>
      </div>
    </MotionConfig>
  );
}
