// TUFFUI (https://tuffui.com) · MIT License · Copyright (c) 2026 TUFFUI contributors
// Vendored from registry/diverging-bars/diverging-bars.tsx at commit 378f3eaa (see ./LICENSE).
// Rewrites at import: "use client" dropped; @/components/ui/surface -> ./surface; @/lib/utils -> @/lib/cn;
// Phosphor ChartBar -> lucide ChartColumn; RollingNumber -> a plain tabular span (no rolling digits in Polo);
// text-muted-foreground / fill-muted-foreground -> text-fg-secondary / fill-fg-secondary; text-foreground /
// fill-foreground -> text-fg-primary / fill-fg-primary; bg-foreground/[0.06] / fill-foreground/[0.06] ->
// bg-fg-primary/[0.06] / fill-fg-primary/[0.06]; bg-surface-raised -> bg-surface-hover; rounded-[3px] / rounded-[2px]
// -> rounded-sm / rounded-xs; var(--brand) -> var(--brand-deep); var(--negative) -> var(--danger); the svg summary
// starts with the title; new showTable prop renders the screen-reader table visibly (DESIGN 9.6 "View as table");
// non-null assertions added for noUncheckedIndexedAccess; double quotes -> single quotes; upstream donation line dropped.
import { ChartColumn } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { EASE_OUT, enter, exit } from '@/lib/motion-tokens';

import { Panel, Shell, ShellHeader } from './surface';

export type DivergingSeries = {
  id: string;
  label: string;
  /** One value per label. */
  values: number[];
  /** Any CSS color. Defaults to the palette by position, so a series keeps its color. */
  color?: string;
};

export type DivergingBarsProps = {
  /** One label per column, e.g. a date. Every few are drawn under the chart. */
  labels: string[];
  /** Stacked upward, first series at the bottom. */
  series: DivergingSeries[];
  /** Hangs below the zero line on its own, smaller scale, e.g. escalations. */
  below?: DivergingSeries;
  /** Big number above the chart, with a caption next to it. */
  headline?: { value: string; caption?: string };
  /** Right side of the headline row: a secondary stat. */
  aside?: React.ReactNode;
  title: string;
  subtitle?: string;
  /** Formats ticks and the tooltip. */
  format?: (value: number) => string;
  /** Called when a column is hovered, clicked or reached with the arrow keys. */
  onSelect?: (index: number) => void;
  /** Show the data table instead of keeping it for screen readers only. */
  showTable?: boolean;
  className?: string;
};

// Validated for both themes: blue, teal, purple, ochre, indigo, cyan.
const palette = ['var(--brand-deep)', '#1a9e8c', '#bf5af2', '#b8862b', '#5e5ce6', '#30b0c7'];
const PAD = { top: 10, right: 34, bottom: 22, left: 0 };
const UP_H = 150;
const DOWN_H = 40;
// Space between the zero line and the first segment on either side.
const ZERO_GAP = 3;

const compact = (n: number) =>
  Math.abs(n) >= 1_000_000
    ? `${+(n / 1_000_000).toFixed(1)}M`
    : Math.abs(n) >= 1000
      ? `${+(n / 1000).toFixed(1)}k`
      : `${Math.round(n)}`;

/** A round upper bound so ticks land on readable numbers. */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / (step / 2)) * (step / 2);
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  // null until measured: the chart draws once at its real width, so entrance
  // animations don't tween from a guessed size.
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width ?? 560, width !== null] as const;
}

const sum = (values: number[]) => values.reduce((n, v) => n + v, 0);

/**
 * Daily stacked columns. Series stack upward as separate rounded segments; one
 * series hangs below the zero line on its own scale, so a small count you care
 * about (escalations, hand-offs) stays readable next to a big one.
 */
export function DivergingBars({
  labels,
  series: input,
  below: belowInput,
  headline,
  aside,
  title,
  subtitle,
  format = compact,
  onSelect,
  showTable = false,
  className,
}: DivergingBarsProps) {
  const reduce = useReducedMotion();
  const [ref, width, measured] = useWidth();
  const [hidden, setHidden] = useState<string[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [fromKeyboard, setFromKeyboard] = useState(false);

  const series = input.map((s, i) => ({
    ...s,
    color: s.color ?? palette[i % palette.length]!,
  }));
  const below = belowInput && {
    ...belowInput,
    color: belowInput.color ?? 'var(--danger)',
  };
  const visible = series.filter((s) => !hidden.includes(s.id));
  const belowOn = !!below && !hidden.includes(below.id);
  const count = labels.length;
  const activeIndex = active !== null && active < count ? active : null;

  const toggle = (id: string, on: boolean) =>
    setHidden((h) =>
      on
        ? // Keep at least one stacked series on.
          id === below?.id || visible.length > 1
          ? [...h, id]
          : h
        : h.filter((x) => x !== id),
    );

  const select = (index: number | null, keyboard: boolean) => {
    setFromKeyboard(keyboard);
    setActive(index);
    if (index !== null) onSelect?.(index);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!count) return;
    const keys: Record<string, number> = {
      ArrowRight: (activeIndex ?? -1) + 1,
      ArrowLeft: (activeIndex ?? count) - 1,
      Home: 0,
      End: count - 1,
    };
    if (event.key === 'Escape') return select(null, true);
    if (!(event.key in keys)) return;
    event.preventDefault();
    select((keys[event.key]! + count) % count, true);
  };

  const totals = labels.map((_, i) => sum(visible.map((s) => s.values[i] ?? 0)));
  const upMax = niceMax(Math.max(0, ...totals));
  const downMax = below ? niceMax(Math.max(0, ...below.values)) : 1;
  const downH = below ? DOWN_H : 0;
  const zero = PAD.top + UP_H;
  const H = zero + (below ? ZERO_GAP + downH : 0) + PAD.bottom + 4;
  const up = (v: number) => (v / upMax) * (UP_H - ZERO_GAP);
  const down = (v: number) => (v / downMax) * downH;

  const innerW = Math.max(width - PAD.left - PAD.right, 40);
  const band = innerW / Math.max(count, 1);
  const barW = Math.min(band * 0.64, 22);
  const gap = barW < 8 ? 1.5 : 2;
  const rx = Math.min(3, barW / 3);
  const x = (i: number) => PAD.left + band * (i + 0.5);
  const labelEvery = Math.ceil(count / Math.max(Math.floor(innerW / 56), 1));

  const rows = (i: number) =>
    [...visible, ...(belowOn && below ? [below] : [])]
      .map((s) => ({ id: s.id, color: s.color, label: s.label, value: s.values[i] ?? 0 }))
      .sort((a, b) => b.value - a.value);
  // The total is the stack; the series below is usually a subset of it (escalated alerts).
  const total = (i: number) => totals[i] ?? 0;

  const allTotal = sum(labels.map((_, i) => total(i)));
  const summary = `${title}. Stacked columns of ${visible.map((s) => s.label).join(', ')}${belowOn && below ? `, with ${below.label} below the line` : ''}, ${labels[0]} to ${labels.at(-1)}, ${format(allTotal)} in total`;

  const tipRight = activeIndex !== null && x(activeIndex) > width - 190;
  const stagger = reduce ? 0 : Math.min(0.02, 0.6 / Math.max(count, 1));

  return (
    <MotionConfig reducedMotion="user">
      <Shell className={cn('max-w-2xl', className)}>
        <ShellHeader icon={ChartColumn} title={title} subtitle={subtitle} />
        <Panel className="p-4">
          {(headline || aside) && (
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              {headline && (
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-2xl font-medium tracking-tight tabular-nums text-fg-primary">
                    {headline.value}
                  </span>
                  {headline.caption && <span className="text-sm text-fg-secondary">{headline.caption}</span>}
                </p>
              )}
              {aside && <div className="text-sm text-fg-secondary">{aside}</div>}
            </div>
          )}

          <div role="group" aria-label="Series" className="mb-3 flex flex-wrap gap-1.5">
            {[...series, ...(below ? [below] : [])].map((s) => {
              const on = !hidden.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(s.id, on)}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs transition-[background-color,color,opacity,scale] duration-150 ease-out active:scale-[0.97]',
                    s.id === below?.id && 'sm:ml-auto',
                    on ? 'bg-fg-primary/[0.06] text-fg-primary' : 'text-fg-secondary opacity-60 hover:opacity-100',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-sm"
                    style={{
                      background: on ? s.color : 'transparent',
                      boxShadow: on ? undefined : `inset 0 0 0 1.5px ${s.color}`,
                    }}
                  />
                  {s.label}
                </button>
              );
            })}
          </div>

          {!showTable && (
            <div
              ref={ref}
              tabIndex={0}
              role="group"
              aria-label={`${title}. Use arrow keys to read columns.`}
              onKeyDown={onKeyDown}
              onBlur={() => fromKeyboard && setActive(null)}
              className="relative rounded-xl outline-offset-4"
            >
              <svg
                key={measured ? 'measured' : 'guess'}
                visibility={measured ? undefined : 'hidden'}
                role="img"
                aria-label={summary}
                width={width}
                height={H}
                className="block overflow-visible"
                onPointerLeave={() => select(null, false)}
              >
                {/* Gridlines and the right axis: the upper scale, zero, the lower scale. */}
                <g fontSize="10" className="text-fg-secondary">
                  {[0.5, 1].map((t) => (
                    <g key={t}>
                      <line
                        x1={PAD.left}
                        x2={PAD.left + innerW}
                        y1={zero - up(upMax * t)}
                        y2={zero - up(upMax * t)}
                        stroke="currentColor"
                        strokeOpacity={0.1}
                        strokeDasharray="2 4"
                      />
                      <text x={width - 4} y={zero - up(upMax * t)} dy="0.32em" textAnchor="end" fill="currentColor">
                        {format(upMax * t)}
                      </text>
                    </g>
                  ))}
                  <line
                    x1={PAD.left}
                    x2={PAD.left + innerW}
                    y1={zero}
                    y2={zero}
                    stroke="currentColor"
                    strokeOpacity={0.22}
                  />
                  <text x={width - 4} y={zero} dy="0.32em" textAnchor="end" fill="currentColor">
                    {format(0)}
                  </text>
                  {below && (
                    <text
                      x={width - 4}
                      y={zero + ZERO_GAP + downH}
                      dy="0.32em"
                      textAnchor="end"
                      style={{ fill: below.color }}
                    >
                      {format(downMax)}
                    </text>
                  )}
                </g>

                {activeIndex !== null && (
                  <rect
                    x={x(activeIndex) - Math.min(band, barW + 8) / 2}
                    y={PAD.top - 6}
                    width={Math.min(band, barW + 8)}
                    height={UP_H + (below ? ZERO_GAP + downH : 0) + 12}
                    rx={Math.min(8, barW / 2 + 4)}
                    className="fill-fg-primary/[0.06]"
                  />
                )}

                {labels.map((label, i) => {
                  let top = zero - ZERO_GAP;
                  const dim = activeIndex !== null && activeIndex !== i;
                  const transition = { duration: 0.45, ease: EASE_OUT, delay: i * stagger };
                  return (
                    <g
                      key={`${label}-${i}`}
                      className={cn(
                        'transition-opacity duration-150 ease-out',
                        dim && 'opacity-40',
                        fromKeyboard && 'duration-0',
                      )}
                    >
                      {visible.map((s) => {
                        const h = up(s.values[i] ?? 0);
                        if (h <= 0) return null;
                        top -= h;
                        // Every segment gives up the gap at its top; tiny ones keep 1px.
                        const segH = Math.max(h - gap, 1);
                        return (
                          <motion.rect
                            key={s.id}
                            x={x(i) - barW / 2}
                            width={barW}
                            rx={rx}
                            initial={{ y: zero - ZERO_GAP, height: 0 }}
                            animate={{ y: top + (h - segH), height: segH }}
                            transition={transition}
                            fill={s.color}
                          />
                        );
                      })}
                      {belowOn && below && (below.values[i] ?? 0) > 0 && (
                        <motion.rect
                          x={x(i) - barW / 2}
                          width={barW}
                          rx={rx}
                          y={zero + ZERO_GAP}
                          initial={{ height: 0 }}
                          animate={{ height: Math.max(down(below.values[i] ?? 0), 1) }}
                          transition={transition}
                          fill={below.color}
                        />
                      )}
                    </g>
                  );
                })}

                {labels.map((label, i) =>
                  i % labelEvery === 0 ? (
                    <text
                      key={`${label}-${i}`}
                      x={x(i)}
                      y={H - 6}
                      textAnchor={i === 0 ? 'start' : 'middle'}
                      dx={i === 0 ? -barW / 2 : 0}
                      fontSize="10"
                      className={cn(activeIndex === i ? 'fill-fg-primary' : 'fill-fg-secondary')}
                    >
                      {label}
                    </text>
                  ) : null,
                )}

                {/* Hit areas: the whole band, both sides of the line. */}
                {labels.map((label, i) => (
                  <rect
                    key={`${label}-${i}`}
                    x={x(i) - band / 2}
                    y={PAD.top - 6}
                    width={band}
                    height={UP_H + (below ? ZERO_GAP + downH : 0) + 12}
                    fill="transparent"
                    onPointerEnter={() => select(i, false)}
                    onClick={() => select(i, false)}
                  />
                ))}
              </svg>

              <AnimatePresence>
                {activeIndex !== null && (
                  <motion.div
                    key="tip"
                    initial={fromKeyboard ? false : { opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1, transition: enter }}
                    exit={{ opacity: 0, transition: exit }}
                    className="pointer-events-none absolute top-0 z-10 min-w-40 rounded-xl bg-surface-hover px-3 py-2 text-xs"
                    style={
                      tipRight
                        ? {
                            right: Math.max(width - x(activeIndex) + band / 2 + 6, 0),
                            transformOrigin: 'top right',
                          }
                        : {
                            left: Math.max(x(activeIndex) + band / 2 + 6, 0),
                            transformOrigin: 'top left',
                          }
                    }
                  >
                    <p className="mb-1 flex justify-between gap-4 font-medium text-fg-primary">
                      <span>{labels[activeIndex]}</span>
                      <span className="font-mono tabular-nums">{format(total(activeIndex))}</span>
                    </p>
                    {rows(activeIndex).map((row) => (
                      <p key={row.id} className="flex items-center gap-2 text-fg-secondary">
                        <span aria-hidden="true" className="size-2 rounded-xs" style={{ background: row.color }} />
                        <span className="flex-1">{row.label}</span>
                        <span className="font-mono text-fg-primary tabular-nums">{format(row.value)}</span>
                      </p>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          <table className={showTable ? 'w-full text-left text-sm tabular-nums text-fg-primary' : 'sr-only'}>
            <caption className={showTable ? 'sr-only' : undefined}>{title}</caption>
            <thead className={showTable ? 'text-xs text-fg-secondary' : undefined}>
              <tr>
                <th scope="col" className="py-1 font-medium">
                  Label
                </th>
                {visible.map((s) => (
                  <th key={s.id} scope="col" className="py-1 font-medium">
                    {s.label}
                  </th>
                ))}
                {belowOn && below && (
                  <th scope="col" className="py-1 font-medium">
                    {below.label}
                  </th>
                )}
                <th scope="col" className="py-1 font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {labels.map((label, i) => (
                <tr key={`${label}-${i}`}>
                  <th scope="row" className="py-1 font-normal">
                    {label}
                  </th>
                  {visible.map((s) => (
                    <td key={s.id} className="py-1">
                      {format(s.values[i] ?? 0)}
                    </td>
                  ))}
                  {belowOn && below && <td className="py-1">{format(below.values[i] ?? 0)}</td>}
                  <td className="py-1">{format(total(i))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p role="status" aria-live="polite" className="sr-only">
            {fromKeyboard && activeIndex !== null
              ? `${labels[activeIndex]}: total ${format(total(activeIndex))}, ${rows(activeIndex)
                  .map((r) => `${r.label} ${format(r.value)}`)
                  .join(', ')}`
              : ''}
          </p>
        </Panel>
      </Shell>
    </MotionConfig>
  );
}
