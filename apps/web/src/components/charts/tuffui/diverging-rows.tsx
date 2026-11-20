// TUFFUI (https://tuffui.com) · MIT License · Copyright (c) 2026 TUFFUI contributors
// Adapted from registry/diverging-bars/diverging-bars.tsx at commit 378f3eaa (see ./LICENSE).
// Rewrites at import: turned horizontal (one signed row per label, positive to
// the right of the zero line, negative to the left), stacking, legend and
// below-series dropped, Polo tokens (success, danger), motion tokens from
// @/lib/motion-tokens, widths rounded to two decimals, onSelect fires on click
// and Enter only, named rows, sr-only table, empty state.

import { MotionConfig, motion, useReducedMotion } from 'motion/react';
import { useState, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { EASE_OUT } from '@/lib/motion-tokens';

export type DivergingRow = {
  label: string;
  /** Signed: positive draws right of zero, negative left. */
  value: number;
};

export type DivergingRowsProps = {
  rows: DivergingRow[];
  /** Used for the accessible names; the caller draws the visible heading. */
  title: string;
  format?: (value: number) => string;
  /** Called when a row is clicked, or reached with the arrow keys and Enter pressed. */
  onSelect?: (index: number) => void;
  /** Shown instead of the chart when there are no rows. */
  empty?: ReactNode;
  className?: string;
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const signed = (v: number) => `${v > 0 ? '+' : ''}${+v.toFixed(1)}`;

/** Signed horizontal bars around one zero line, e.g. what pushes a win up or down. */
export function DivergingRows({ rows, title, format = signed, onSelect, empty, className }: DivergingRowsProps) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const [fromKeyboard, setFromKeyboard] = useState(false);

  if (!rows.length) {
    return <p className={cn('py-6 text-center text-sm text-fg-secondary', className)}>{empty ?? 'Nothing to show yet.'}</p>;
  }

  const n = rows.length;
  const peak = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)));
  // Each side gets half the track; the longest bar fills its half.
  const pct = (v: number) => r2((Math.abs(v) / peak) * 50);
  const rowText = (i: number) => `${rows[i]!.label}: ${format(rows[i]!.value)}`;

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
      ArrowDown: (active ?? -1) + 1,
      ArrowRight: (active ?? -1) + 1,
      ArrowUp: (active ?? n) - 1,
      ArrowLeft: (active ?? n) - 1,
      Home: 0,
      End: n - 1,
    };
    if (event.key === 'Escape') return select(null, true);
    if (!(event.key in keys)) return;
    event.preventDefault();
    select((keys[event.key]! + n) % n, true);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn('w-full', className)}>
        <div
          tabIndex={0}
          role="group"
          aria-label={`${title}. Use arrow keys to read rows.`}
          onKeyDown={onKeyDown}
          onBlur={() => fromKeyboard && setActive(null)}
          onPointerLeave={() => select(null, false)}
          className="flex flex-col gap-1.5 rounded-xl outline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
        >
          {rows.map((row, i) => {
            const positive = row.value >= 0;
            const w = pct(row.value);
            const dim = active !== null && active !== i;
            return (
              <div
                key={`${row.label}-${i}`}
                role="img"
                aria-label={rowText(i)}
                onPointerEnter={() => select(i, false)}
                onClick={() => {
                  select(i, false);
                  onSelect?.(i);
                }}
                className={cn(
                  'grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_3rem] items-center gap-3 rounded-lg px-1 py-1 text-sm transition-[opacity,background-color] duration-150',
                  active === i && 'bg-[var(--surface-hover)]',
                  dim && 'opacity-50',
                  fromKeyboard && 'duration-0',
                  onSelect && 'cursor-pointer',
                )}
              >
                <span className="truncate text-fg-secondary">{row.label}</span>
                <span aria-hidden="true" className="relative h-2.5">
                  <span className="absolute -inset-y-1 left-1/2 w-px bg-[var(--border-subtle)]" />
                  <motion.span
                    className={cn('absolute inset-y-0 rounded-sm', positive ? 'bg-[var(--success)]' : 'bg-[var(--danger)]')}
                    style={positive ? { left: '50%' } : { right: '50%' }}
                    initial={reduce ? false : { width: '0%' }}
                    animate={{ width: `${w}%` }}
                    transition={{ duration: 0.4, ease: EASE_OUT, delay: reduce ? 0 : i * 0.03 }}
                  />
                </span>
                <span className={cn('text-right font-mono tabular-nums', positive ? 'text-success' : 'text-danger')}>
                  {format(row.value)}
                </span>
              </div>
            );
          })}
        </div>

        <table className="sr-only">
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">Factor</th>
              <th scope="col">Effect</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.label}-${i}`}>
                <th scope="row">{row.label}</th>
                <td>{format(row.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p role="status" aria-live="polite" className="sr-only">
          {fromKeyboard && active !== null ? rowText(active) : ''}
        </p>
      </div>
    </MotionConfig>
  );
}
