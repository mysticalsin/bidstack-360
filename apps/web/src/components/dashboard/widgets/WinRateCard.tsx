/**
 * dashboard/widgets/WinRateCard.tsx — animated SVG ring chart showing the
 * closed-deal win/loss ratio in the OrgDashboard sidebar.
 *
 * WHY a separate module: the ring SVG + empty-state zero-bid fallback is
 * ~72 source lines of self-contained animation logic that will be replaced
 * by real cohort data when the Reports module ships.
 */
import { motion } from 'framer-motion';

import { GlassCard } from '@/components/ui/GlassCard';

// ─── WinRateCard ─────────────────────────────────────────────────────────────

const RING_RADIUS = 26;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function WinRateCard({
  won,
  lost,
  reduced,
}: {
  won: number;
  lost: number;
  reduced: boolean | null;
}) {
  const total = won + lost;
  const rate = total > 0 ? Math.round((won / total) * 100) : 0;

  return (
    <GlassCard padding="sm" hoverable={false}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)] px-1 pt-1 pb-2">
        Win rate
      </div>
      <div className="flex items-center gap-3">
        {total === 0 ? (
          <div className="flex h-[60px] w-[60px] items-center justify-center rounded-full border border-dashed border-[var(--border-default)] text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
            No closed bids
          </div>
        ) : (
          <div className="win-rate-ring">
            <svg viewBox="0 0 60 60" aria-hidden>
              <circle
                cx="30"
                cy="30"
                r={RING_RADIUS}
                fill="none"
                stroke="var(--surface-sunken)"
                strokeWidth="5"
              />
              <motion.circle
                cx="30"
                cy="30"
                r={RING_RADIUS}
                fill="none"
                stroke={rate >= 50 ? 'var(--success)' : 'var(--warning)'}
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${RING_CIRCUMFERENCE}`}
                initial={{ strokeDashoffset: `${RING_CIRCUMFERENCE}` }}
                animate={{ strokeDashoffset: `${RING_CIRCUMFERENCE * (1 - rate / 100)}` }}
                transform="rotate(-90 30 30)"
                transition={reduced ? { duration: 0 } : { duration: 1, ease: 'easeOut' }}
              />
            </svg>
            <span
              className="win-rate-text"
              style={{ color: rate >= 50 ? 'var(--success)' : 'var(--warning)' }}
            >
              {rate}%
            </span>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
            <span className="text-[var(--fg-secondary)]">{won} won</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-[var(--tag-rose-fg)]" />
            <span className="text-[var(--fg-secondary)]">{lost} lost</span>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
