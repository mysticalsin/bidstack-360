/**
 * dashboard/widgets/WorkspaceHealthCard.tsx — circular SVG health gauge for
 * the OrgDashboard sidebar.
 *
 * WHY a separate module: the animated SVG gauge (~93 source lines) is a
 * self-contained visualization with its own band/label/color logic. Keeping it
 * in a dedicated file makes it straightforward to swap for a real metric later.
 */
import { motion } from 'framer-motion';

import { GlassCard } from '@/components/ui/GlassCard';
import { Badge } from '@/components/ui/Badge';
import { AnimatedMetric } from '@/components/motion/AnimatedMetric';

// ─── WorkspaceHealthCard ─────────────────────────────────────────────────────

export function WorkspaceHealthCard({
  score,
  reduced,
}: {
  score: number;
  reduced: boolean | null;
}) {
  const scorePct = Math.max(0, Math.min(100, score)) / 100;
  const band =
    score >= 80 ? 'strong' : score >= 60 ? 'good' : score >= 40 ? 'needs_attention' : 'critical';
  const bandLabel =
    band === 'strong'
      ? 'Excellent'
      : band === 'good'
        ? 'Good'
        : band === 'needs_attention'
          ? 'Needs Attention'
          : 'Critical';
  const bandColor =
    band === 'strong'
      ? 'var(--success)'
      : band === 'good'
        ? 'var(--brand-primary)'
        : band === 'needs_attention'
          ? 'var(--warning)'
          : 'var(--danger)';

  return (
    <GlassCard padding="md" hoverable={false} className="health-gauge-card">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-[var(--fg-primary)]">Workspace Health</span>
        <Badge
          tone={
            band === 'strong'
              ? 'jade'
              : band === 'good'
                ? 'blue'
                : band === 'needs_attention'
                  ? 'amber'
                  : 'tomato'
          }
        >
          {bandLabel}
        </Badge>
      </div>
      <div className="health-gauge-body">
        <div className="health-gauge-visual">
          <svg viewBox="0 0 180 180" aria-hidden>
            <defs>
              <linearGradient id="health-gauge-gradient" x1="20" x2="160" y1="160" y2="20">
                <stop offset="0%" stopColor="var(--danger)" />
                <stop offset="42%" stopColor="var(--warning)" />
                <stop offset="100%" stopColor="var(--success)" />
              </linearGradient>
            </defs>
            <circle className="health-gauge-track" cx="90" cy="90" r="72" pathLength="1" />
            <motion.circle
              className="health-gauge-progress"
              cx="90"
              cy="90"
              r="72"
              pathLength="1"
              initial={{ strokeDashoffset: 1 }}
              animate={{ strokeDashoffset: 1 - scorePct }}
              transition={reduced ? { duration: 0 } : { duration: 1.2, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ stroke: 'url(#health-gauge-gradient)' }}
            />
          </svg>
          <div className="health-gauge-core">
            <span style={{ color: bandColor }}>
              <AnimatedMetric value={score.toString()} />
            </span>
            <small>/100</small>
          </div>
        </div>
        <div className="health-gauge-legend">
          <div className="health-gauge-stat">
            <span>Data quality</span>
            <strong style={{ color: 'var(--success)' }}>Good</strong>
          </div>
          <div className="health-gauge-stat">
            <span>Engagement</span>
            <strong style={{ color: score >= 60 ? 'var(--success)' : 'var(--warning)' }}>
              {Math.round(score * 0.9)}%
            </strong>
          </div>
          <div className="health-gauge-stat">
            <span>Pipeline velocity</span>
            <strong style={{ color: score >= 50 ? 'var(--brand-primary)' : 'var(--warning)' }}>
              {Math.round(score * 0.75)}%
            </strong>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
