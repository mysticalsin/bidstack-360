/**
 * dashboard/widgets/AlertCard.tsx — linked alert card used for overdue tasks
 * and open service cases in the OrgDashboard sidebar.
 *
 * WHY a separate module: AlertCard is a reusable pattern (icon + value + total
 * + href) that appears twice in the sidebar with different props. Extracting
 * it makes future alert types a one-liner in OrgDashboard.
 */
import { Link } from 'react-router-dom';

import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/ui/Icon';

import { type KpiTone, TONE_BG, TONE_FG, TONE_GLOW } from './dashboard-types';

// ─── AlertCard ───────────────────────────────────────────────────────────────

export function AlertCard({
  tone,
  icon,
  label,
  value,
  total,
  href,
}: {
  tone: KpiTone;
  icon: string;
  label: string;
  value: number;
  total: number;
  href: string;
}) {
  return (
    <GlassCard hoverable={false}>
      <Link
        to={href}
        className="flex items-center gap-3"
        style={{ textDecoration: 'none', color: 'inherit' }}
      >
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{
            background: TONE_BG[tone],
            color: TONE_FG[tone],
            boxShadow: `0 0 12px ${TONE_GLOW[tone]}`,
          }}
        >
          <Icon name={icon} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
            {label}
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-xl font-bold tabular-nums" style={{ color: TONE_FG[tone] }}>
              {value}
            </span>
            <span className="text-xs text-[var(--fg-secondary)]">of {total}</span>
          </div>
        </div>
      </Link>
    </GlassCard>
  );
}
