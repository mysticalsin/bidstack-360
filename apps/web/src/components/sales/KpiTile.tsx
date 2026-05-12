// One KPI tile for the Sales Dashboard. Mirrors the Odoo tile shape:
//   label    →   big number   →   ↑/↓ delta vs previous period
// When `onClick` is passed the tile renders as a `<button>` and drills into
// a pre-filtered list. With no handler it stays a plain `<div>` (no
// keyboard affordance, no focus ring — exactly what a static stat needs).

import clsx from 'clsx';
import { motion, useReducedMotion } from 'framer-motion';

import { formatPctDelta } from '@/lib/format';
import { springSnap } from '@/lib/motion';

interface Props {
  label: string;
  value: string;
  /** Percentage vs previous period; null hides the line. */
  deltaPct: number | null;
  /** Optional accent — the tile gets a soft tint of this tone. */
  tone?: 'blue' | 'jade' | 'amber' | 'tomato' | 'gray';
  /** Optional click handler (e.g. open the underlying list). */
  onClick?: () => void;
}

const TONE_BG: Record<NonNullable<Props['tone']>, string> = {
  blue: 'bg-[var(--surface-card)]',
  jade: 'bg-[var(--surface-card)]',
  amber: 'bg-[#fff7ea]',
  tomato: 'bg-[#ffeded]',
  gray: 'bg-[var(--surface-card)]',
};

const TONE_ACCENT: Record<NonNullable<Props['tone']>, string> = {
  blue: 'from-sky-500 to-blue-400',
  jade: 'from-emerald-500 to-teal-300',
  amber: 'from-amber-500 to-yellow-300',
  tomato: 'from-rose-500 to-orange-300',
  gray: 'from-[var(--accent)] to-[var(--accent-strong)]',
};

export function KpiTile({ label, value, deltaPct, tone = 'gray', onClick }: Props) {
  const positive = deltaPct !== null && deltaPct > 0;
  const negative = deltaPct !== null && deltaPct < 0;
  const reducedMotion = useReducedMotion();
  const motionProps = reducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 10, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        whileHover: { y: -3 },
        whileTap: onClick ? { scale: 0.985 } : undefined,
        transition: springSnap,
      };

  const content = (
    <>
      <span
        aria-hidden="true"
        className={clsx(
          'pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r',
          TONE_ACCENT[tone],
        )}
      />
      <div className="text-[11px] font-semibold tracking-wide text-[var(--fg-secondary)]">
        {label}
      </div>
      <motion.div
        key={value}
        initial={reducedMotion ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSnap}
        className="mt-1.5 text-3xl font-semibold tabular-nums text-[var(--fg-primary)]"
      >
        {value}
      </motion.div>
      <div
        className={clsx(
          'mt-1.5 text-xs tabular-nums',
          positive && 'text-[var(--success)]',
          negative && 'text-[var(--danger)]',
          !positive && !negative && 'text-[var(--fg-tertiary)]',
        )}
      >
        {formatPctDelta(deltaPct)} since last period
      </div>
    </>
  );

  if (onClick) {
    return (
      <motion.button
        onClick={onClick}
        type="button"
        {...motionProps}
        className={clsx(
          'relative w-full min-h-[88px] overflow-hidden rounded-lg border border-[var(--border-subtle)] p-4 text-left',
          'transition-colors hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]',
          TONE_BG[tone],
        )}
      >
        {content}
      </motion.button>
    );
  }

  return (
    <motion.div
      {...motionProps}
      className={clsx(
        'relative w-full min-h-[88px] overflow-hidden rounded-lg border border-[var(--border-subtle)] p-4 text-left',
        'transition-colors hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-sm)]',
        TONE_BG[tone],
      )}
    >
      {content}
    </motion.div>
  );
}
