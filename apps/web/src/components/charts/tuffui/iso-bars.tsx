// TUFFUI (https://tuffui.com) · MIT License · Copyright (c) 2026 TUFFUI contributors
// Vendored from registry/iso-bars/iso-bars.tsx at commit 378f3eaa (see ./LICENSE).
// Rewrites at import: Shell/Panel/ShellHeader, the header aside and the
// Phosphor icon removed (the caller owns the card and heading), the face
// textures and their useId dropped, @/lib/utils to @/lib/cn, shadcn colour
// classes swapped for Polo tokens, hex palettes to var(--chart-*), negative
// to danger, onSelect fires on click and Enter only, named prisms, empty state.

import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { useLayoutEffect, useState, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { EASE_OUT, enter, exit, instant } from '@/lib/motion-tokens';

export type IsoSeries = {
  id: string;
  label: string;
  /** One value per period. Series stack upward in order. */
  values: number[];
  /** Any CSS color. Faces are shaded from it, so it works in both themes. */
  color?: string;
};

export type IsoRow = 'back' | 'front';

export type IsoBarsProps = {
  /** One label per column, drawn along the front edge of the floor. */
  labels: string[];
  /** The main stack, drawn in the back row. */
  back: IsoSeries[];
  /** A smaller stack in front of it, e.g. the overdue part. */
  front?: IsoSeries[];
  /** Used for the accessible names; the caller draws the visible heading. */
  title: string;
  /** Formats values in the tooltip and the table. */
  format?: (value: number) => string;
  /** Called when a prism is clicked, or reached with the arrow keys and Enter pressed. */
  onSelect?: (point: { row: IsoRow; index: number }) => void;
  /** Shown instead of the chart when there are no columns. */
  empty?: ReactNode;
  className?: string;
};

const backPalette = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
const frontPalette = ['var(--warning)', 'var(--danger)', 'var(--chart-7)', 'var(--chart-8)'];

/** Screen units per floor cell. The svg scales to its container. */
const K = 40;
/** Gap around a prism inside its cell, as a share of the cell. */
const INSET = 0.18;
/** Where each row starts in depth, in cells. */
const ROW_V = { back: 0, front: 1.05 };
const PLATE = 0.35;
const THICK = 5;

const round = (n: number) => Math.round(n * 100) / 100;

/** Isometric projection: u runs along periods, v toward the viewer, h up. */
const iso = (u: number, v: number, h: number) => [round((u - v) * K), round(((u + v) * K) / 2 - h)] as const;

const path = (points: (readonly [number, number])[]) => `M${points.map(([x, y]) => `${x} ${y}`).join('L')}Z`;

const compact = (n: number) =>
  Math.abs(n) >= 1_000_000
    ? `${+(n / 1_000_000).toFixed(1)}M`
    : Math.abs(n) >= 1000
      ? `${+(n / 1000).toFixed(1)}k`
      : `${+n.toFixed(1)}`;

function useWidth() {
  // Callback ref: the chart can mount on its empty state and gain data later,
  // so measurement attaches whenever the element appears.
  const [el, ref] = useState<HTMLDivElement | null>(null);
  // null until measured: the chart draws once at its real width, so entrance
  // animations don't tween from a guessed size.
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first layout measurement of the attached element.
    setWidth(el.getBoundingClientRect().width || null);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [ref, width ?? 560, width !== null] as const;
}

type Colored = IsoSeries & { color: string };

type Prism = {
  row: IsoRow;
  index: number;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  segments: { series: Colored; h0: number; h1: number }[];
  total: number;
  height: number;
};

/** The three visible faces of one segment, at a share of its full height. */
function faces(p: Prism, h0: number, h1: number, top: boolean, grow: number) {
  const a = h0 * grow;
  const b = h1 * grow;
  return {
    left: path([iso(p.u0, p.v1, a), iso(p.u1, p.v1, a), iso(p.u1, p.v1, b), iso(p.u0, p.v1, b)]),
    right: path([iso(p.u1, p.v1, a), iso(p.u1, p.v0, a), iso(p.u1, p.v0, b), iso(p.u1, p.v1, b)]),
    top: top ? path([iso(p.u0, p.v0, b), iso(p.u1, p.v0, b), iso(p.u1, p.v1, b), iso(p.u0, p.v1, b)]) : null,
  };
}

/**
 * Stacked bars as isometric prisms on a floor plate. The back row holds the
 * main stack per column, the front row a smaller one, so the risk in a column
 * sits right next to its total.
 */
export function IsoBars({ labels, back, front = [], title, format = compact, onSelect, empty, className }: IsoBarsProps) {
  const reduce = useReducedMotion();
  const [ref, width, measured] = useWidth();
  const [active, setActive] = useState<{ row: IsoRow; index: number } | null>(null);
  const [fromKeyboard, setFromKeyboard] = useState(false);

  const n = labels.length;
  if (!n) {
    return <p className={cn('py-6 text-center text-sm text-fg-secondary', className)}>{empty ?? 'Nothing to show yet.'}</p>;
  }

  const rows: { row: IsoRow; series: Colored[] }[] = [
    { row: 'back' as const, series: back.map((s, i) => ({ ...s, color: s.color ?? backPalette[i % backPalette.length]! })) },
    { row: 'front' as const, series: front.map((s, i) => ({ ...s, color: s.color ?? frontPalette[i % frontPalette.length]! })) },
  ].filter((r) => r.series.length);
  const rowNames = rows.map((r) => r.row);
  const depth = (rowNames.includes('front') ? ROW_V.front : 0) + 1;

  const totalOf = (series: Colored[], i: number) => series.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0);
  const peak = Math.max(1, ...rows.flatMap((r) => labels.map((_, i) => totalOf(r.series, i))));
  // Taller plots for longer floors, so prisms keep their proportions.
  const maxH = Math.min(Math.max((n + depth) * K * 0.4, 140), 280);

  const prisms: Prism[] = rows.flatMap(({ row, series }) =>
    labels.map((_, index) => {
      let h = 0;
      const segments = series.map((s) => {
        const h0 = h;
        h = round(h + (Math.max(0, s.values[index] ?? 0) / peak) * maxH);
        return { series: s, h0, h1: h };
      });
      return {
        row,
        index,
        u0: index + INSET,
        u1: index + 1 - INSET,
        v0: ROW_V[row] + INSET,
        v1: ROW_V[row] + 1 - INSET,
        segments,
        total: totalOf(series, index),
        height: h,
      };
    }),
  );
  // Painter's order: farther from the viewer first.
  const drawOrder = [...prisms].sort((a, b) => a.u0 + a.v0 - (b.u0 + b.v0));

  // Fit the viewBox around the plate, the tallest prism tops and the labels.
  const plate = [iso(-PLATE, -PLATE, 0), iso(n + PLATE, -PLATE, 0), iso(n + PLATE, depth + PLATE, 0), iso(-PLATE, depth + PLATE, 0)] as const;
  const tops = prisms.map((p) => iso(p.u0, p.v0, p.height)[1]);
  const minY = Math.min(plate[0][1], ...tops) - 8;
  const maxX = plate[1][0] + 4;
  // Labels keep their screen size, so the room they need left of the first
  // one depends on the scale, which depends on that room. Solve for it.
  const labelX = iso(0.5, depth + PLATE + 0.2, 0)[0];
  const labelPx = Math.max(0, ...labels.map((l) => l.length)) * 6.2 + 4;
  const fitW = Math.max(width, labelPx + 120);
  const minX = Math.min(plate[3][0] - 4, (labelX * fitW - labelPx * maxX) / (fitW - labelPx));
  const vbW = round(maxX - minX);
  const scale = fitW / vbW;
  // Keep text at 10px on screen and thin labels out when columns get close.
  const fontSize = round(10 / scale);
  const maxY = plate[2][1] + THICK + fontSize * 1.6;
  const vbH = round(maxY - minY);
  const labelEvery = Math.max(1, Math.ceil(24 / (K * scale)));

  const find = (row: IsoRow, index: number) => prisms.find((p) => p.row === row && p.index === index);
  const current = active ? find(active.row, active.index) : undefined;
  const prismText = (p: Prism) =>
    `${labels[p.index]}, ${p.row} row: ${p.segments.map(({ series: s }) => `${s.label} ${format(s.values[p.index] ?? 0)}`).join(', ')}`;

  const select = (next: { row: IsoRow; index: number } | null, keyboard: boolean) => {
    setFromKeyboard(keyboard);
    setActive(next);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!rowNames.length) return;
    if (event.key === 'Escape') return select(null, true);
    if ((event.key === 'Enter' || event.key === ' ') && active) {
      event.preventDefault();
      onSelect?.(active);
      return;
    }
    const row = active?.row ?? rowNames[0]!;
    const index = active?.index;
    const at = rowNames.indexOf(row);
    const moves: Record<string, { row: IsoRow; index: number }> = {
      ArrowRight: { row, index: index === undefined ? 0 : (index + 1) % n },
      ArrowLeft: { row, index: index === undefined ? n - 1 : (index - 1 + n) % n },
      ArrowUp: { row: rowNames[Math.max(at - 1, 0)]!, index: index ?? 0 },
      ArrowDown: { row: rowNames[Math.min(at + 1, rowNames.length - 1)]!, index: index ?? 0 },
      Home: { row, index: 0 },
      End: { row, index: n - 1 },
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    select(moves[event.key]!, true);
  };

  const mainTotals = labels.map((_, i) => totalOf(rows[0]?.series ?? [], i));
  const peakIndex = mainTotals.indexOf(Math.max(...mainTotals));
  const summary = `${title}: ${rows
    .flatMap((r) => r.series.map((s) => s.label))
    .join(', ')} from ${labels[0]} to ${labels.at(-1)}${peakIndex >= 0 ? `, highest ${labels[peakIndex]}` : ''}`;

  const all = rows.flatMap((r) => r.series);
  const tip = current && {
    x: ((iso((current.u0 + current.u1) / 2, (current.v0 + current.v1) / 2, 0)[0] - minX) / vbW) * 100,
    y: ((iso(current.u0, current.v0, current.height)[1] - minY) / vbH) * 100,
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn('w-full', className)}>
        <div
          ref={ref}
          tabIndex={0}
          role="group"
          aria-label={`${title}. Use left and right arrows to read columns, up and down to switch rows.`}
          onKeyDown={onKeyDown}
          onBlur={() => fromKeyboard && setActive(null)}
          className="relative rounded-xl outline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
        >
          <svg
            key={measured ? 'measured' : 'guess'}
            visibility={measured ? undefined : 'hidden'}
            role="img"
            aria-label={summary}
            viewBox={`${round(minX)} ${round(minY)} ${vbW} ${vbH}`}
            className="block h-auto w-full"
            onPointerLeave={() => select(null, false)}
          >
            {/* Floor plate with a thin front edge. */}
            <path
              d={path([plate[3], plate[2], iso(n + PLATE, depth + PLATE, -THICK), iso(-PLATE, depth + PLATE, -THICK)])}
              style={{ fill: 'var(--fg-primary)' }}
              fillOpacity={0.08}
            />
            <path
              d={path([plate[2], plate[1], iso(n + PLATE, -PLATE, -THICK), iso(n + PLATE, depth + PLATE, -THICK)])}
              style={{ fill: 'var(--fg-primary)' }}
              fillOpacity={0.11}
            />
            <path d={path([...plate])} style={{ fill: 'var(--fg-primary)' }} fillOpacity={0.05} />

            {labels.map((label, i) => {
              if (i % labelEvery) return null;
              const [x, y] = iso(i + 0.5, depth + PLATE + 0.2, -THICK);
              const on = active?.index === i;
              return (
                <text
                  key={i}
                  x={x}
                  y={y}
                  dy="0.9em"
                  textAnchor="end"
                  fontSize={fontSize}
                  className={cn(
                    'font-mono transition-colors duration-150',
                    on ? 'fill-fg-primary' : 'fill-fg-secondary',
                    fromKeyboard && 'duration-0',
                  )}
                >
                  {label}
                </text>
              );
            })}

            {drawOrder.map((p) => {
              const dim = active !== null && (active.row !== p.row || active.index !== p.index);
              const last = p.segments.findLastIndex((s) => s.h1 > s.h0);
              return (
                <g
                  key={`${p.row}-${p.index}`}
                  role="graphics-symbol"
                  aria-label={prismText(p)}
                  className={cn(
                    'transition-opacity duration-150',
                    dim && 'opacity-35',
                    fromKeyboard && 'duration-0',
                    onSelect && 'cursor-pointer',
                  )}
                  onPointerEnter={() => select({ row: p.row, index: p.index }, false)}
                  onClick={() => {
                    select({ row: p.row, index: p.index }, false);
                    onSelect?.({ row: p.row, index: p.index });
                  }}
                >
                  {p.segments.map((s, k) => {
                    if (s.h1 <= s.h0) return null;
                    const full = faces(p, s.h0, s.h1, k === last, 1);
                    // Rise from a sliver, not from nothing.
                    const from = faces(p, s.h0, s.h1, k === last, 0.04);
                    const transition = reduce
                      ? instant
                      : { duration: 0.5, ease: EASE_OUT, delay: p.index * 0.03 + (p.row === 'front' ? 0.08 : 0) };
                    const c = s.series.color;
                    const shades = [
                      { d: full.left, from: from.left, fill: c },
                      { d: full.right, from: from.right, fill: `color-mix(in oklab, ${c}, black 28%)` },
                      { d: full.top, from: from.top, fill: `color-mix(in oklab, ${c}, white 30%)` },
                    ];
                    return shades.map((f, j) =>
                      f.d && f.from ? (
                        <motion.path
                          key={`${s.series.id}-${j}`}
                          initial={reduce ? false : { d: f.from }}
                          animate={{ d: f.d }}
                          transition={transition}
                          style={{ fill: f.fill }}
                        />
                      ) : null,
                    );
                  })}
                </g>
              );
            })}
          </svg>

          <AnimatePresence>
            {current && tip && (
              <div
                key="tip"
                className="pointer-events-none absolute z-10"
                style={{
                  left: `clamp(0px, calc(${round(tip.x)}% + 14px), calc(100% - 9.5rem))`,
                  top: `max(0px, calc(${round(tip.y)}% - 1.5rem))`,
                }}
              >
                <motion.div
                  initial={fromKeyboard ? false : { opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1, transition: enter }}
                  exit={{ opacity: 0, transition: exit }}
                  className="w-max min-w-28 max-w-40 origin-top-left rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-2 text-xs shadow-[var(--shadow-md)]"
                >
                  <p className="text-fg-secondary">{labels[current.index]}</p>
                  {current.segments.length === 1 ? (
                    <p className="font-mono text-fg-primary tabular-nums">
                      {format(current.total)} · {current.segments[0]!.series.label.toLowerCase()}
                    </p>
                  ) : (
                    <>
                      {[...current.segments].reverse().map(({ series: s }) => (
                        <p key={s.id} className="flex items-center gap-2 text-fg-secondary">
                          <span aria-hidden="true" className="size-2 rounded-sm" style={{ background: s.color }} />
                          <span className="flex-1 truncate">{s.label}</span>
                          <span className="font-mono text-fg-primary tabular-nums">{format(s.values[current.index] ?? 0)}</span>
                        </p>
                      ))}
                      <p className="mt-1 flex justify-between gap-2 font-medium text-fg-primary">
                        Total
                        <span className="font-mono tabular-nums">{format(current.total)}</span>
                      </p>
                    </>
                  )}
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-secondary">
          {rows.map((r, i) => (
            <span key={r.row} className="contents">
              {i > 0 && <span aria-hidden="true" className="h-3 w-px bg-[var(--border-subtle)]" />}
              {r.series.map((s) => (
                <span key={s.id} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2.5 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
            </span>
          ))}
        </div>

        <table className="sr-only">
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">Label</th>
              {all.map((s) => (
                <th key={s.id} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, i) => (
              <tr key={i}>
                <th scope="row">{label}</th>
                {all.map((s) => (
                  <td key={s.id}>{format(s.values[i] ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p role="status" aria-live="polite" className="sr-only">
          {fromKeyboard && current ? prismText(current) : ''}
        </p>
      </div>
    </MotionConfig>
  );
}
