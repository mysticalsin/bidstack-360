// One KPI tile for the Sales Dashboard. Mirrors the Odoo tile shape:
//   label    →   big number   →   ↑/↓ delta vs previous period
// When `onClick` is passed the tile renders as a `<button>` and drills into
// a pre-filtered list. With no handler it stays a plain `<div>` (no
// keyboard affordance, no focus ring — exactly what a static stat needs).

import clsx from 'clsx';

import { formatPctDelta } from '@/lib/format';

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

export function KpiTile({ label, value, deltaPct, tone = 'gray', onClick }: Props) {
  const positive = deltaPct !== null && deltaPct > 0;
  const negative = deltaPct !== null && deltaPct < 0;
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      className={clsx(
        'w-full min-h-[88px] rounded-lg border border-[var(--border-subtle)] p-4 text-left',
        'transition-shadow hover:shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
        TONE_BG[tone],
      )}
    >
      <div className="text-[11px] font-semibold tracking-wide text-[var(--fg-secondary)]">
        {label}
      </div>
      <div className="mt-1.5 text-3xl font-semibold tabular-nums text-[var(--fg-primary)]">
        {value}
      </div>
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
    </Comp>
  );
}
