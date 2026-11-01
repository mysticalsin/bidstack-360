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
import { useTranslation } from 'react-i18next';

import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/ui/Icon';
import { springSoft } from '@/lib/motion';
import { formatUnspecifiedAmount, UNSPECIFIED_CURRENCY_BASIS } from '../unspecified-currency';

// ─── SalesFunnelCard ─────────────────────────────────────────────────────────

/** Count bars share one scale. A currency amount is not a count, so it does not set the width. */
export function funnelCountWidths(counts: number[]): number[] {
  const maxVal = Math.max(...counts, 1);
  return counts.map((count) => (count <= 0 ? 0 : Math.max(20, Math.round((count / maxVal) * 100))));
}

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
  const { t } = useTranslation('crm');
  const countWidths = funnelCountWidths([leads, opportunities, openOpps]);
  const stages = [
    {
      label: t('salesFunnel.stageLeads', 'Leads'),
      display: leads.toLocaleString(),
      widthPct: countWidths[0] ?? 0,
      color: 'var(--fg-secondary)',
      bg: 'var(--surface-sunken)',
    },
    {
      label: t('salesFunnel.stageOpportunities', 'Opportunities'),
      display: opportunities.toLocaleString(),
      widthPct: countWidths[1] ?? 0,
      color: 'var(--fg-secondary)',
      bg: 'var(--surface-sunken)',
    },
    {
      label: t('salesFunnel.stageOpenDeals', 'Open Deals'),
      display: openOpps.toLocaleString(),
      widthPct: countWidths[2] ?? 0,
      color: 'var(--fg-secondary)',
      bg: 'var(--surface-sunken)',
    },
    {
      label: t('salesFunnel.stagePipeline', 'Pipeline'),
      display: `${formatUnspecifiedAmount(pipelineValue)} (${UNSPECIFIED_CURRENCY_BASIS})`,
      widthPct: 100,
      color: 'var(--brand-primary)',
      bg: 'var(--brand-primary-tint)',
    },
  ];

  return (
    <GlassCard padding="md" hoverable={false}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--surface-sunken)]">
            <Icon name="filter" size={13} className="text-[var(--brand-primary)]" />
          </div>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('salesFunnel.title', 'Sales funnel')}
          </h2>
        </div>
        <Link to="/pipeline" className="text-xs text-[var(--brand-primary)] hover:underline">
          {t('salesFunnel.viewPipeline', 'View pipeline')}
        </Link>
      </div>
      <div className="funnel-viz">
        {stages.map((stage, i) => {
          const widthPct = stage.widthPct;
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
                    {stage.display}
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
