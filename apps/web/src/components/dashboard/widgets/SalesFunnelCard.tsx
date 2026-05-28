/**
 * dashboard/widgets/SalesFunnelCard.tsx — animated horizontal funnel
 * visualization for the OrgDashboard main column.
 *
 * WHY a separate module: SalesFunnelCard has its own stage-width calculation,
 * color mapping, and sequential animation (~96 source lines). Extracting it
 * makes the funnel independently replaceable with a real D3/Recharts chart.
 */
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/ui/Icon';
import { springSoft } from '@/lib/motion';
import { formatMoney } from '@/lib/format';

// ─── SalesFunnelCard ─────────────────────────────────────────────────────────

export function SalesFunnelCard({
  leads,
  opportunities,
  openOpps,
  pipelineValue,
  reduced,
}: {
  leads: number;
  opportunities: number;
  openOpps: number;
  pipelineValue: number;
  reduced: boolean | null;
}) {
  const stages = [
    { label: 'Leads', count: leads, color: 'var(--tag-purple-fg)', bg: 'var(--tag-purple-bg)' },
    {
      label: 'Opportunities',
      count: opportunities,
      color: 'var(--tag-amber-fg)',
      bg: 'var(--tag-amber-bg)',
    },
    { label: 'Open Deals', count: openOpps, color: 'var(--tag-teal-fg)', bg: 'var(--tag-teal-bg)' },
    {
      label: 'Pipeline',
      count: pipelineValue,
      display: formatMoney(pipelineValue, 'EUR'),
      color: 'var(--tag-jade-fg)',
      bg: 'var(--tag-jade-bg)',
      isMoney: true,
    },
  ];

  const maxVal = Math.max(leads, opportunities, openOpps, 1);

  return (
    <GlassCard padding="md" hoverable={false}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--surface-sunken)]">
            <Icon name="filter" size={13} className="text-[var(--brand-primary)]" />
          </div>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Sales funnel</h2>
        </div>
        <Link to="/pipeline" className="text-xs text-[var(--brand-primary)] hover:underline">
          View pipeline
        </Link>
      </div>
      <div className="funnel-viz">
        {stages.map((stage, i) => {
          const widthPct = stage.isMoney ? 100 : Math.max(20, (stage.count / maxVal) * 100);
          return (
            <motion.div
              key={stage.label}
              className="funnel-stage"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springSoft, delay: reduced ? 0 : i * 0.08 }}
            >
              <div className="funnel-stage-bar-outer">
                <motion.div
                  className="funnel-stage-bar"
                  style={{
                    width: `${widthPct}%`,
                    background: stage.bg,
                    color: stage.color,
                  }}
                  initial={reduced ? { width: `${widthPct}%` } : { width: '0%' }}
                  animate={{ width: `${widthPct}%` }}
                  transition={{ ...springSoft, delay: reduced ? 0 : i * 0.08 + 0.1 }}
                >
                  {/* All tag backgrounds are very light, so fg-primary has sufficient contrast */}
                  <span
                    className="funnel-stage-label"
                    style={{ color: 'var(--fg-primary)', opacity: 0.75 }}
                  >
                    {stage.label}
                  </span>
                  <span className="funnel-stage-value" style={{ color: 'var(--fg-primary)' }}>
                    {stage.display ?? stage.count.toLocaleString()}
                  </span>
                </motion.div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </GlassCard>
  );
}
